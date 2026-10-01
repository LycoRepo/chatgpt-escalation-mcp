#!/usr/bin/env python3
"""
Robust ChatGPT Desktop Automation Driver for Windows

This driver wraps robust_flow.py to provide a JSON-based interface
for the MCP server. All the heavy lifting is done by RobustChatGPTFlow.

Protocol:
- Receives JSON commands on stdin
- Returns JSON responses on stdout
- Debug messages go to stderr

Commands:
- check_chatgpt: Check if ChatGPT can be found/started
- focus_chatgpt: Focus the ChatGPT window
- find_conversation: Navigate to project + conversation
- send_message: Send a message
- wait_for_response: Wait for response to complete
- get_last_response: Copy and return the response
"""

import sys
import json
import os

# Add driver directory to path
_driver_dir = os.path.dirname(os.path.abspath(__file__))
if _driver_dir not in sys.path:
    sys.path.insert(0, _driver_dir)

from robust_flow import RobustChatGPTFlow, log_debug


class RobustDriver:
    """
    MCP-compatible driver using RobustChatGPTFlow.
    
    Maps MCP commands to robust_flow methods.
    """
    
    def __init__(self):
        self.flow = RobustChatGPTFlow()
        self._last_prompt = None
    
    def check_chatgpt(self) -> dict:
        """Read-only availability check using the same identity policy as execution."""
        hwnd = self.flow._find_chatgpt_hwnd()
        return {
            "success": True,
            "data": {
                "found": bool(hwnd),
                "message": "Verified target window found" if hwnd else
                    "No unique verified target window. Configure CHATGPT_EXECUTABLE_PATH and open the intended app.",
                "ui_compatibility_verified": False,
            },
        }

    def focus_chatgpt(self) -> dict:
        """Focus or start ChatGPT window."""
        # Use robust flow's step sequence
        # Kill -> Start -> Focus ensures clean state
        
        if not self.flow.step1_kill_chatgpt():
            return {"success": False, "error": "Failed to kill existing ChatGPT"}
        
        if not self.flow.step2_start_chatgpt():
            return {"success": False, "error": "Failed to start ChatGPT"}
        
        if not self.flow.step3_focus_chatgpt():
            return {"success": False, "error": "Failed to focus ChatGPT"}
        
        return {"success": True}
    
    def find_conversation(self, title: str, project_name: str = None) -> dict:
        """
        Navigate to a conversation.
        
        Args:
            title: Conversation name
            project_name: Project/folder name (optional but recommended)
        """
        # Ensure we have a focused window
        if self.flow.hwnd is None:
            # Run initialization steps
            if not self.flow.step1_kill_chatgpt():
                return {"success": False, "error": "Failed to kill existing ChatGPT"}
            if not self.flow.step2_start_chatgpt():
                return {"success": False, "error": "Failed to start ChatGPT"}
            if not self.flow.step3_focus_chatgpt():
                return {"success": False, "error": "Failed to focus ChatGPT"}
        
        # Open sidebar
        if not self.flow.step4_open_sidebar():
            return {"success": False, "error": "Failed to open sidebar"}
        
        # Navigate to project (if specified)
        if project_name:
            if not self.flow.step5_click_project(project_name):
                return {"success": False, "error": f"Failed to find project: {project_name}"}
        
        # Navigate to conversation
        if not self.flow.step6_click_conversation(title):
            return {"success": False, "error": f"Failed to find conversation: {title}"}
        
        return {
            "success": True,
            "data": {
                "conversation": title,
                "project": project_name,
                "method": "robust_flow"
            }
        }
    
    def send_message(self, message: str) -> dict:
        """Send a message to the current conversation (combined focus+send)."""
        log_debug(f"[driver] send_message called, len={len(message)}")
        ok = self.flow.step7_send_prompt(message)
        log_debug(f"[driver] step7_send_prompt returned: {ok}")
        if not ok:
            return {"success": False, "error": "Failed to focus/send message"}
        self._last_prompt = message
        return {"success": True}
    
    def wait_for_response(self, timeout_ms: int = 600000) -> dict:
        """Wait for ChatGPT to finish generating."""
        timeout_sec = timeout_ms / 1000.0
        
        if not self.flow.step9_wait_for_response(timeout=timeout_sec):
            return {"success": False, "error": f"Timeout waiting for response ({timeout_ms}ms)"}
        
        return {"success": True}
    
    def get_last_response(self) -> dict:
        """Copy and return the last response."""
        response = self.flow.step10_copy_response()
        
        if not response:
            return {"success": False, "error": "Failed to copy response"}
        
        return {
            "success": True,
            "data": {
                "response": response
            }
        }
    
    # Convenience method: full escalation in one call
    def escalate(self, project_name: str, conversation: str, message: str, timeout_ms: int = 600000, run_id: str = None) -> dict:
        """
        Full escalation flow in one call using execute_full_flow.
        
        Uses robust_flow's execute_full_flow which has:
        - Proper phase logging
        - Navigation retry logic
        - Response validation
        - failed_step tracking
        
        Includes aggressive retry logic - will retry the ENTIRE flow multiple times
        since many failures are transient (chaos moved window, focus lost, etc).
        
        If all retries fail, returns a clear error message instructing the user
        not to interfere while the agent is working.
        """
        if run_id:
            log_debug(f"[{run_id}] Starting escalation: project={project_name}, conversation={conversation}")
        else:
            log_debug(f"Starting escalation: project={project_name}, conversation={conversation}")
        
        # Almost all failures are recoverable - the whole point is to retry the entire flow
        # Only truly fatal errors (like invalid config) should not be retried
        NON_RECOVERABLE_REASONS = {
            "invalid_config",    # Bad project/conversation names
            "invalid_response",  # Response validation failed (not a retry issue)
        }
        
        max_attempts = 4  # Try up to 4 times total (initial + 3 retries)
        last_error = None
        last_step = None
        last_reason = None
        
        for attempt in range(max_attempts):
            if attempt > 0:
                log_debug(f"[{run_id or 'no-run-id'}] RETRY attempt {attempt + 1}/{max_attempts}: restarting entire flow")
                # Fresh flow instance to reset all state
                self.flow = RobustChatGPTFlow()
                # Brief pause between retries - not too long or chaos will time out
                import time
                time.sleep(1.5)
            
            # Use the full flow with all its bells and whistles
            result = self.flow.execute_full_flow(
                project_name=project_name or "",
                conversation_name=conversation,
                prompt=message
            )
            
            if result["success"]:
                response = result.get("response", "")
                # Check if we actually got a response
                if response and len(response.strip()) > 10:
                    return {
                        "success": True,
                        "data": {
                            "response": response,
                            "project": project_name,
                            "conversation": conversation,
                            "run_id": run_id,
                            "attempts": attempt + 1
                        }
                    }
                else:
                    # "Success" but empty/invalid response - treat as failure and retry
                    log_debug(f"[{run_id or 'no-run-id'}] Flow succeeded but response is empty/invalid, retrying...")
                    last_error = "Response was empty or too short"
                    last_step = 10
                    last_reason = "empty_response"
                    continue
            
            # Failure - capture details
            failed_step = result.get("failed_step")
            error = result.get("error", "Unknown error")
            error_reason = self._derive_error_reason(failed_step, error)
            
            last_error = error
            last_step = failed_step
            last_reason = error_reason
            
            log_debug(f"[{run_id or 'no-run-id'}] Attempt {attempt + 1} failed: step={failed_step}, reason={error_reason}, error={error}")
            
            # Check if this is a non-recoverable error
            if error_reason in NON_RECOVERABLE_REASONS:
                log_debug(f"[{run_id or 'no-run-id'}] Non-recoverable error ({error_reason}), stopping retries")
                break
            
            # Otherwise, we'll retry on the next iteration
        
        # All attempts failed - return a clear error message for the agent to relay to the user
        user_message = (
            f"ChatGPT escalation failed after {max_attempts} attempts. "
            f"Last failure was at step {last_step} ({last_reason}): {last_error}. "
            f"\n\n⚠️ IMPORTANT: Please keep your hands off the keyboard and mouse while the agent is working with ChatGPT. "
            f"Window movements, clicks, or keyboard input can interfere with the automation. "
            f"If the problem persists, try closing other applications and running the escalation again."
        )
        
        return {
            "success": False,
            "error": user_message,
            "failed_step": last_step,
            "error_reason": last_reason,
            "run_id": run_id,
            "attempts": max_attempts
        }
    
    def _derive_error_reason(self, step: int, error: str) -> str:
        """Derive a structured error reason code from step and error message."""
        if step is None:
            return "unknown"
        
        error_lower = error.lower()
        
        # Step-specific reason codes
        step_reasons = {
            1: "kill_failed",
            2: "start_failed",
            3: "focus_failed",
            4: "sidebar_failed",
            5: "project_not_found",
            6: "conversation_not_found",
            7: "send_failed",
            9: "response_timeout",
            10: "copy_failed",
        }
        
        base_reason = step_reasons.get(step, f"step{step}_failed")
        
        # Refine based on error message
        if "empty" in error_lower or "too short" in error_lower:
            return "empty_response"
        elif "not found" in error_lower or "failed to find" in error_lower:
            if step == 5:
                return "project_not_found"
            elif step == 6:
                return "conversation_not_found"
        elif "timeout" in error_lower:
            return "timeout"
        elif "focus" in error_lower:
            return "focus_lost"
        elif "validation failed" in error_lower:
            return "invalid_response"
        
        return base_reason


def main():
    """Main entry point - process commands from stdin."""
    driver = RobustDriver()
    
    # Read command from stdin
    try:
        input_data = sys.stdin.read()
        command = json.loads(input_data)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON input: {e}"}))
        return
    
    action = command.get("action")
    params = command.get("params", {})
    
    log_debug(f"Executing action: {action}")
    
    # Dispatch to appropriate handler
    if action == "check_chatgpt":
        result = driver.check_chatgpt()
    
    elif action == "focus_chatgpt":
        result = driver.focus_chatgpt()
    
    elif action == "find_conversation":
        result = driver.find_conversation(
            title=params.get("title", ""),
            project_name=params.get("project_name")
        )
    
    elif action == "send_message":
        result = driver.send_message(params.get("message", ""))
    
    elif action == "wait_for_response":
        result = driver.wait_for_response(params.get("timeout_ms", 600000))
    
    elif action == "get_last_response":
        result = driver.get_last_response()
    
    elif action == "escalate":
        # Full flow in one call
        result = driver.escalate(
            project_name=params.get("project_name"),
            conversation=params.get("conversation"),
            message=params.get("message", ""),
            timeout_ms=params.get("timeout_ms", 600000),
            run_id=params.get("run_id")
        )
    
    else:
        result = {"success": False, "error": f"Unknown action: {action}"}
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()
