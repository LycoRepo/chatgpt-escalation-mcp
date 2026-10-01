import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AppConfig, Platform } from "../types.js";
import { getLogger } from "./logging.js";

const CONFIG_DIR_NAME = ".chatgpt-escalation";
const CONFIG_FILE_NAME = "config.json";

/**
 * Get the user-level config directory path
 */
export function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, CONFIG_DIR_NAME);
}

/**
 * Get the full path to the config file
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Detect the current platform
 */
export function detectPlatform(): Platform {
  const platform = os.platform();
  if (platform === "win32") return "win";
  if (platform === "darwin") return "mac";
  // Default to win, but warn
  return "win";
}

/**
 * Load default configuration
 */
function loadDefaultConfig(): AppConfig {
  return {
    chatgpt: {
      platform: detectPlatform(),
      // Default to 10 minutes to accommodate long, complex responses
      responseTimeout: 600000,
      projects: {},
    },
    logging: {
      level: "info",
    },
  };
}

/**
 * Deep merge configuration objects
 */
function deepMerge(target: AppConfig, source: Partial<AppConfig>): AppConfig {
  const result: AppConfig = {
    chatgpt: { ...target.chatgpt },
    logging: { ...target.logging },
  };

  if (source.chatgpt) {
    result.chatgpt = {
      ...target.chatgpt,
      ...source.chatgpt,
      projects: {
        ...target.chatgpt.projects,
        ...(source.chatgpt.projects || {}),
      },
    };
  }

  if (source.logging) {
    result.logging = {
      ...target.logging,
      ...source.logging,
    };
  }

  return result;
}

/**
 * Load user configuration, merged with defaults
 */
export function loadConfig(): AppConfig {
  const logger = getLogger("config");
  const defaultConfig = loadDefaultConfig();
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    logger.debug("No user config found, using defaults");
    return defaultConfig;
  }

  try {
    const userConfigRaw = fs.readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(userConfigRaw) as Partial<AppConfig>;
    logger.debug("Loaded user config", { path: configPath });
    return deepMerge(defaultConfig, userConfig);
  } catch (error) {
    logger.error("Failed to load user config, using defaults", { error });
    return defaultConfig;
  }
}

/**
 * Save configuration to the user config file
 */
export function saveConfig(config: AppConfig): void {
  const logger = getLogger("config");
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  // Ensure config directory exists with proper permissions
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); // Owner read/write/execute only
  }

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    logger.info("Configuration saved", { path: configPath });
  } catch (error) {
    logger.error("Failed to save config", { error });
    throw new Error(`Failed to save configuration: ${error}`);
  }
}

/**
 * Validate the configuration
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: AppConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate chatgpt section
  if (!config.chatgpt) {
    errors.push("Missing 'chatgpt' configuration section");
  } else {
    // Check platform
    if (!["win", "mac"].includes(config.chatgpt.platform)) {
      errors.push(`Invalid platform: ${config.chatgpt.platform}. Must be 'win' or 'mac'`);
    }

    // Check projects
    if (!config.chatgpt.projects || Object.keys(config.chatgpt.projects).length === 0) {
      errors.push("No projects configured. Run 'chatgpt-escalation-mcp init' to set up projects.");
    } else {
      // Validate each project
      for (const [projectId, entry] of Object.entries(config.chatgpt.projects)) {
        const conversationTitle = typeof entry === 'string' ? entry : entry?.conversation;
        if (!conversationTitle || conversationTitle.trim() === "") {
          errors.push(`Project '${projectId}' has no conversation title configured`);
        }
      }
    }

    // Check timeout
    for (const field of ["executablePath", "pythonExecutable"] as const) {
      const value = config.chatgpt[field];
      if (value !== undefined && (typeof value !== "string" || !path.win32.isAbsolute(value) || !path.win32.parse(value).root.includes(":"))) {
        errors.push(`chatgpt.${field} must be an absolute Windows path`);
      }
    }
    for (const field of ["allowUnifiedApp", "restartTarget"] as const) {
      if (config.chatgpt[field] !== undefined && typeof config.chatgpt[field] !== "boolean") {
        errors.push(`chatgpt.${field} must be a boolean`);
      }
    }
    if (config.chatgpt.responseTimeout && config.chatgpt.responseTimeout < 60000) {
      warnings.push("Timeout is very low (< 60s), ChatGPT responses may take longer");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get the conversation title for a specific project
 */
export function getProjectConversation(config: AppConfig, projectId: string): string | null {
  const entry = config.chatgpt.projects[projectId];
  if (!entry) return null;
  
  // Handle both string and object formats
  if (typeof entry === 'string') {
    return entry;
  }
  return entry.conversation;
}

/**
 * Get the project folder for a specific project (if configured)
 */
export function getProjectFolder(config: AppConfig, projectId: string): string | null {
  const entry = config.chatgpt.projects[projectId];
  if (!entry) return null;
  
  // Only object format has folder
  if (typeof entry === 'string') {
    return null;
  }
  return entry.folder || null;
}

/**
 * Check if config directory and file exist
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Initialize config directory structure
 */
export function initConfigDir(): void {
  const configDir = getConfigDir();

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Get config summary for display
 */
export function getConfigSummary(config: AppConfig): string {
  const projectCount = Object.keys(config.chatgpt.projects).length;
  const projectList = Object.entries(config.chatgpt.projects)
    .map(([id, entry]) => {
      if (typeof entry === 'string') {
        return `    ${id}: "${entry}"`;
      }
      return `    ${id}: "${entry.conversation}"${entry.folder ? ` (in folder: ${entry.folder})` : ''}`;
    })
    .join("\n") || "    none";

  return `
Configuration Summary:
  Config path: ${getConfigPath()}
  Platform: ${config.chatgpt.platform}
  Response timeout: ${config.chatgpt.responseTimeout}ms
  Log level: ${config.logging.level}
  Projects (${projectCount}):
${projectList}
`.trim();
}
