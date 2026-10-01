// ============================================================================
// Escalation Artifacts
// ============================================================================

export type ArtifactType = "file_snippet" | "log" | "note";

export interface EscalationArtifact {
  type: ArtifactType;
  pathOrLabel?: string;
  content: string;
}

// ============================================================================
// Escalation Packet (Input from Agent)
// ============================================================================

export type BackendType = "chatgpt-desktop";

export interface EscalationPacket {
  backend?: BackendType;
  project: string;
  reason: string;
  question: string;
  attempted?: string;
  projectContext?: string;
  artifacts?: EscalationArtifact[];
}

// ============================================================================
// Expert Response (Output to Agent)
// ============================================================================

export type Priority = "low" | "medium" | "high";

export interface ExpertResponse {
  guidance: string;
  action_plan: string[];
  priority: Priority;
  notes_for_user?: string;
}

// ============================================================================
// Backend Interface
// ============================================================================

export interface ExpertBackend {
  name: BackendType;
  sendEscalation(packet: EscalationPacket): Promise<ExpertResponse>;
  checkAvailability(): Promise<{ available: boolean; message: string }>;
  cleanup(): Promise<void>;
}

// ============================================================================
// Configuration Types
// ============================================================================

export type Platform = "win" | "mac";

// Project can be either a simple string (conversation title) or an object with folder
export interface ProjectConfig {
  folder?: string;       // Optional: Project folder name in ChatGPT sidebar
  conversation: string;  // Conversation title within the folder (or at root)
}

// Projects can be either simple strings or ProjectConfig objects
export type ProjectEntry = string | ProjectConfig;

export interface ChatGPTConfig {
  platform: Platform;
  responseTimeout: number;
  projects: Record<string, ProjectEntry>; // projectId -> conversation title or ProjectConfig
  executablePath?: string; // Explicit Windows application executable; never matched by name alone
  pythonExecutable?: string; // Optional isolated Python runtime
  allowUnifiedApp?: boolean; // Explicit identity opt-in; does not certify UI compatibility
  restartTarget?: boolean; // Defaults to false; never restarts the unified ChatGPT/Codex app
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  file?: string;
}

export interface AppConfig {
  chatgpt: ChatGPTConfig;
  logging: LoggingConfig;
}

// ============================================================================
// MCP Tool Schema Types
// ============================================================================

export interface EscalateToolInput {
  backend?: BackendType;
  project: string;
  reason: string;
  question: string;
  attempted?: string;
  projectContext?: string;
  artifacts?: EscalationArtifact[];
}

// ============================================================================
// Driver Types (Communication with Python/AppleScript)
// ============================================================================

export interface DriverCommand {
  action: 
    | "check_chatgpt"
    | "find_conversation"
    | "send_message"
    | "wait_for_response"
    | "get_last_response"
    | "focus_chatgpt"
    | "escalate";
  params?: Record<string, unknown>;
}

export interface DriverResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================================================
// CLI Types
// ============================================================================

export interface InitWizardResult {
  platform: Platform;
  projects: Record<string, string>;
}

export interface DoctorResult {
  configValid: boolean;
  chatgptFound: boolean;
  pythonAvailable: boolean;
  projectsValid: Record<string, boolean>;
  errors: string[];
  warnings: string[];
}
