import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type {
  ExpertBackend,
  EscalationPacket,
  ExpertResponse,
  AppConfig,
  DriverCommand,
  DriverResult,
} from "../types.js";
import { getLogger } from "../util/logging.js";
import { buildPrompt, extractJson, validateExpertResponse } from "../util/promptBuilder.js";
import { getProjectConversation, getProjectFolder } from "../util/configLoader.js";

const logger = getLogger("chatgpt-desktop");

// Mutex for sequential operations
let operationMutex: Promise<void> = Promise.resolve();

/**
 * Acquire mutex for sequential operations
 */
function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = operationMutex;
  let releaseMutex: () => void;

  operationMutex = new Promise((resolve) => {
    releaseMutex = resolve;
  });

  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      releaseMutex!();
    }
  });
}

/**
 * Get the path to the driver script for the current platform
 */
export function getDriverPath(platform: "win" | "mac"): string {
  // Resolve from the installed package, never a caller-controlled working directory.
  const scriptName = platform === "win" ? "driver_robust.py" : "driver.scpt";
  let packageRoot = __dirname;
  while (true) {
    const manifest = path.join(packageRoot, "package.json");
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === "chatgpt-escalation-mcp") break;
    const parent = path.dirname(packageRoot);
    if (parent === packageRoot) throw new Error("Cannot locate the installed escalation package");
    packageRoot = parent;
  }
  for (const directory of ["src/drivers", "drivers"]) {
    const root = path.join(packageRoot, directory);
    const candidate = path.join(root, platform, scriptName);
    if (fs.existsSync(candidate)) {
      const realRoot = fs.realpathSync(root);
      const realCandidate = fs.realpathSync(candidate);
      const relative = path.relative(realRoot, realCandidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Driver resolves outside the installed package");
      return realCandidate;
    }
  }
  throw new Error(`Driver not found in the installed package for platform: ${platform}`);
}

/**
 * Execute a driver command on Windows using Python
 */
async function executeWindowsDriver(command: DriverCommand, config?: AppConfig): Promise<DriverResult> {
  const driverPath = getDriverPath("win");
  logger.debug("Executing Windows driver", { command: command.action, driverPath });

  // Security: Validate driver path exists and is within expected directory
  const validatedPath = path.resolve(driverPath);
  if (!fs.existsSync(validatedPath)) {
    logger.error("Driver script not found", { path: validatedPath });
    return { success: false, error: `Driver not found: ${path.basename(validatedPath)}` };
  }

  // getDriverPath already checks the real path against the installed package root.

  return new Promise((resolve) => {
    const env = { ...process.env };
    if (config?.chatgpt.executablePath !== undefined) env.CHATGPT_EXECUTABLE_PATH = config.chatgpt.executablePath;
    if (config?.chatgpt.allowUnifiedApp !== undefined) env.CHATGPT_ALLOW_UNIFIED_APP = config.chatgpt.allowUnifiedApp ? "1" : "0";
    if (config?.chatgpt.restartTarget !== undefined) env.CHATGPT_RESTART_TARGET = config.chatgpt.restartTarget ? "1" : "0";
    const python = spawn(config?.chatgpt.pythonExecutable || env.CHATGPT_PYTHON_EXECUTABLE || "python", [validatedPath], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      shell: false, // Security: Never use shell to prevent command injection
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (code !== 0) {
        logger.error("Python driver exited with error", { code, stderr });
        resolve({ success: false, error: stderr || `Exit code: ${code}` });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        logger.error("Failed to parse driver response", { stdout, error: e });
        resolve({ success: false, error: `Invalid response: ${stdout}` });
      }
    });

    python.on("error", (err) => {
      logger.error("Failed to spawn Python driver", { error: err });
      resolve({ success: false, error: `Failed to run driver: ${err.message}` });
    });

    // Send command to stdin
    python.stdin.write(JSON.stringify(command));
    python.stdin.end();
  });
}

/**
 * Execute a driver command on macOS using AppleScript
 */
async function executeMacDriver(command: DriverCommand): Promise<DriverResult> {
  const driverPath = getDriverPath("mac");
  logger.debug("Executing macOS driver", { command: command.action, driverPath });

  return new Promise((resolve) => {
    const osascript = spawn("osascript", [driverPath, JSON.stringify(command)]);

    let stdout = "";
    let stderr = "";

    osascript.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    osascript.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    osascript.on("close", (code) => {
      if (code !== 0) {
        logger.error("AppleScript driver exited with error", { code, stderr });
        resolve({ success: false, error: stderr || `Exit code: ${code}` });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        logger.error("Failed to parse driver response", { stdout, error: e });
        resolve({ success: false, error: `Invalid response: ${stdout}` });
      }
    });

    osascript.on("error", (err) => {
      logger.error("Failed to spawn AppleScript driver", { error: err });
      resolve({ success: false, error: `Failed to run driver: ${err.message}` });
    });
  });
}

/**
 * Execute a driver command based on platform
 */
async function executeDriver(
  platform: "win" | "mac",
  command: DriverCommand,
  config?: AppConfig
): Promise<DriverResult> {
  if (platform === "win") {
    return executeWindowsDriver(command, config);
  } else {
    return executeMacDriver(command);
  }
}

/**
 * Detect if a response is a template echo instead of a real answer.
 * ChatGPT sometimes returns the format template instead of answering.
 */
function isTemplateResponse(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  
  const response = parsed as Record<string, unknown>;
  
  // Check for template priority (contains | indicating it's the template text)
  const priority = String(response.priority || "");
  if (priority.includes("|")) {
    logger.debug("Template detected: priority contains '|'");
    return true;
  }
  
  // Check for template guidance phrases
  const guidance = String(response.guidance || "").toLowerCase();
  const templatePhrases = [
    "one-sentence summary",
    "your main guidance",
    "explanation here",
    "what the agent should do",
  ];
  for (const phrase of templatePhrases) {
    if (guidance.includes(phrase)) {
      logger.debug(`Template detected: guidance contains '${phrase}'`);
      return true;
    }
  }
  
  // Check for template action_plan with generic steps
  const actionPlan = response.action_plan;
  if (Array.isArray(actionPlan)) {
    const templateSteps = ["step 1", "step 2", "step 3", "action 1", "action 2"];
    for (const step of actionPlan) {
      const stepLower = String(step).toLowerCase().trim();
      if (templateSteps.includes(stepLower)) {
        logger.debug(`Template detected: action_plan contains '${step}'`);
        return true;
      }
    }
  }
  
  // Check for wrong field name (notes_for_darien instead of notes_for_user)
  if ("notes_for_darien" in response) {
    logger.debug("Template detected: contains 'notes_for_darien' instead of 'notes_for_user'");
    return true;
  }
  
  return false;
}

/**
 * Send an escalation to ChatGPT Desktop
 */
async function sendEscalation(
  packet: EscalationPacket,
  config: AppConfig
): Promise<ExpertResponse> {
  return withMutex(async () => {
    const { platform, responseTimeout } = config.chatgpt;
    const maxTemplateRetries = 2;  // Retry up to 2 times if template detected
    
    // Generate unique run ID for this escalation (for observability)
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    logger.info("Sending escalation via ChatGPT Desktop", {
      runId,
      project: packet.project,
      platform,
    });

    // Step 1: Check ChatGPT is available
    const checkResult = await executeDriver(platform, { action: "check_chatgpt" }, config);
    if (!checkResult.success) {
      throw new Error(`ChatGPT Desktop check failed: ${checkResult.error}`);
    }
    
    const checkData = checkResult.data as { found: boolean; message?: string };
    if (!checkData.found) {
      throw new Error(checkData.message || "ChatGPT Desktop not found. Please open the application.");
    }
    logger.debug("ChatGPT Desktop found");

    // Build prompt
    const prompt = buildPrompt(packet);
    logger.debug("Built prompt", { length: prompt.length });

    const conversationTitle = getProjectConversation(config, packet.project);
    if (!conversationTitle) {
      throw new Error(`No conversation configured for project: ${packet.project}`);
    }
    const projectFolder = getProjectFolder(config, packet.project);

    // Retry loop for template detection
    for (let attempt = 1; attempt <= maxTemplateRetries + 1; attempt++) {
      const isRetry = attempt > 1;
      const messageToSend = isRetry 
        ? `You returned the JSON template format instead of actually answering. Please read my QUESTION and respond with a real answer using the JSON format:\n\n${prompt}`
        : prompt;
      
      if (isRetry) {
        logger.info(`Retrying after template response (attempt ${attempt})`);
      }

      const escalateResult = await executeDriver(platform, {
        action: "escalate",
        params: {
          run_id: runId,
          project_name: projectFolder || undefined,
          conversation: conversationTitle,
          message: messageToSend,
          timeout_ms: responseTimeout,
        },
      }, config);
      if (!escalateResult.success) {
        // Include runId in error for correlation
        const errorData = escalateResult as { error?: string; failed_step?: number; error_reason?: string };
        logger.error("Escalation failed", {
          runId,
          error: errorData.error,
          failedStep: errorData.failed_step,
          errorReason: errorData.error_reason,
        });
        throw new Error(`Escalation failed: ${escalateResult.error}`);
      }
      logger.debug("Escalation completed", { runId, project: packet.project, conversation: conversationTitle, attempt });

      const responseData = escalateResult.data as { response: string };
      const rawResponse = responseData.response;
      logger.debug("Got raw response", { length: rawResponse.length });

      // Parse JSON response
      const jsonText = extractJson(rawResponse);
      let parsed: unknown;

      try {
        parsed = JSON.parse(jsonText);
      } catch (error) {
        logger.error("Failed to parse JSON response", { jsonText, error });
        throw new Error(`Failed to parse ChatGPT response as JSON: ${error}`);
      }

      // Validate response format
      if (!validateExpertResponse(parsed)) {
        logger.error("Invalid response format", { parsed });
        throw new Error("ChatGPT response does not match expected format");
      }

      // Check for template response
      if (isTemplateResponse(parsed)) {
        if (attempt <= maxTemplateRetries) {
          logger.warn("Template response detected, will retry", { attempt, maxRetries: maxTemplateRetries });
          continue;  // Retry with clarification
        } else {
          logger.error("Template response persisted after retries", { attempt });
          throw new Error("ChatGPT returned template format instead of answering. Try again or simplify your question.");
        }
      }

      logger.info("Escalation completed successfully");
      return parsed;
    }

    // Should not reach here
    throw new Error("Escalation failed after all attempts");
  });
}

/**
 * Check if ChatGPT Desktop is available
 */
async function checkAvailability(
  config: AppConfig
): Promise<{ available: boolean; message: string }> {
  const { platform } = config.chatgpt;

  try {
    const result = await executeDriver(platform, { action: "check_chatgpt" }, config);

    if (!result.success) {
      return { available: false, message: result.error || "Driver error" };
    }

    const data = result.data as { found: boolean; message?: string };
    return {
      available: data.found,
      message: data.found
        ? "ChatGPT Desktop is running"
        : data.message || "ChatGPT Desktop not found",
    };
  } catch (error) {
    return {
      available: false,
      message: `Error checking ChatGPT: ${error}`,
    };
  }
}

/**
 * Send a raw message (for testing, bypasses escalation format)
 */
async function sendRawMessage(
  message: string,
  projectId: string,
  config: AppConfig
): Promise<string> {
  return withMutex(async () => {
    const { platform, responseTimeout } = config.chatgpt;
    logger.info("Sending raw message via ChatGPT Desktop", { projectId, platform });

    // Step 1: Check ChatGPT is available
    const checkResult = await executeDriver(platform, { action: "check_chatgpt" }, config);
    if (!checkResult.success) {
      throw new Error(`ChatGPT Desktop check failed: ${checkResult.error}`);
    }
    
    const checkData = checkResult.data as { found: boolean; message?: string };
    if (!checkData.found) {
      throw new Error(checkData.message || "ChatGPT Desktop not found. Please open the application.");
    }

    // Step 2: Focus ChatGPT window
    const focusResult = await executeDriver(platform, { action: "focus_chatgpt" }, config);
    if (!focusResult.success) {
      throw new Error(`Failed to focus ChatGPT: ${focusResult.error}`);
    }

    // Step 3: Find the project conversation
    const conversationTitle = getProjectConversation(config, projectId);
    if (!conversationTitle) {
      throw new Error(`No conversation configured for project: ${projectId}`);
    }

    // Get optional project folder for vision-based navigation
    const projectFolder = getProjectFolder(config, projectId);

    const findResult = await executeDriver(platform, {
      action: "find_conversation",
      params: { 
        title: conversationTitle,
        project_name: projectFolder || undefined
      },
    }, config);
    if (!findResult.success) {
      throw new Error(`Failed to find conversation "${conversationTitle}": ${findResult.error}`);
    }

    // Step 4: Send the message directly
    const sendResult = await executeDriver(platform, {
      action: "send_message",
      params: { message },
    }, config);
    if (!sendResult.success) {
      throw new Error(`Failed to send message: ${sendResult.error}`);
    }

    // Step 5: Wait for response
    const waitResult = await executeDriver(platform, {
      action: "wait_for_response",
      params: { timeout_ms: responseTimeout },
    }, config);
    if (!waitResult.success) {
      throw new Error(`Timeout waiting for response: ${waitResult.error}`);
    }

    // Step 6: Get the response
    const getResult = await executeDriver(platform, { action: "get_last_response" }, config);
    if (!getResult.success) {
      throw new Error(`Failed to get response: ${getResult.error}`);
    }

    const responseData = getResult.data as { response: string };
    return responseData.response;
  });
}

/**
 * Cleanup (no-op for desktop backend)
 */
async function cleanup(): Promise<void> {
  logger.debug("Cleanup called (no-op for desktop backend)");
}

/**
 * Create the ChatGPT Desktop backend
 */
export function createChatGPTDesktopBackend(config: AppConfig): ExpertBackend & {
  sendRawMessage: (message: string, projectId: string) => Promise<string>;
} {
  return {
    name: "chatgpt-desktop",
    sendEscalation: (packet: EscalationPacket) => sendEscalation(packet, config),
    checkAvailability: () => checkAvailability(config),
    cleanup,
    sendRawMessage: (message: string, projectId: string) => sendRawMessage(message, projectId, config),
  };
}

/**
 * Check if Python and required packages are available (Windows only)
 */
export async function checkPythonDependencies(): Promise<{
  available: boolean;
  message: string;
}> {
  return new Promise((resolve) => {
    const python = spawn("python", ["-c", "import pywinauto; import pyperclip; print('ok')"]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (code === 0 && stdout.trim() === "ok") {
        resolve({ available: true, message: "Python dependencies available" });
      } else {
        resolve({
          available: false,
          message: `Missing Python dependencies. Run: pip install pywinauto pyperclip\n${stderr}`,
        });
      }
    });

    python.on("error", () => {
      resolve({
        available: false,
        message: "Python not found. Please install Python 3.x",
      });
    });
  });
}
