#!/usr/bin/env python3
"""
Aether UI — Native Hermes Agent Plugin Bridge & Launcher

Provides a Python entry point for Hermes Agent (hermes plugins install / hermes plugins enable)
and interfaces with the Aether MCP Server and Studio Runtime on http://127.0.0.1:4173.
"""

import sys
import os
import json
import subprocess
import urllib.request
import urllib.error

DEFAULT_PORT = 4173
DEFAULT_URL = f"http://127.0.0.1:{DEFAULT_PORT}"

def get_studio_url():
    return os.environ.get("AETHER_STUDIO_URL", DEFAULT_URL)

def ping_server(url=None):
    if url is None:
        url = get_studio_url()
    try:
        req = urllib.request.Request(f"{url}/api/state")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            return resp.status == 200
    except Exception:
        return False

def start_mcp_server():
    """Starts the Node.js MCP server in stdio mode."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    mcp_script = os.path.join(script_dir, "dist", "src", "mcp", "aether-mcp-server.js")
    
    if not os.path.exists(mcp_script):
        # Build if dist missing
        subprocess.run(["npm", "run", "build"], cwd=script_dir, check=True)

    proc = subprocess.Popen(
        ["node", mcp_script],
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stderr,
        env=os.environ.copy()
    )
    proc.wait()

def call_tool(tool_name, arguments=None):
    """Invokes an Aether UI tool via the Studio Server REST API."""
    if arguments is None:
        arguments = {}
        
    url = get_studio_url()
    
    endpoints = {
        "aether_status": ("/api/state", "GET"),
        "aether_submit_context": ("/api/session/context", "POST"),
        "aether_generate_ux": ("/api/ux/generate", "POST"),
        "aether_select_ux": ("/api/ux/select", "POST"),
        "aether_generate_ui": ("/api/ui/generate", "POST"),
        "aether_select_ui": ("/api/ui/select", "POST"),
        "aether_edit_component": ("/api/edit/direct", "POST"),
        "aether_approve_promote": ("/api/approval/promote", "POST"),
        "aether_restore_checkpoint": ("/api/checkpoint/restore", "POST"),
        "aether_export_handoff": ("/api/handoff/export?format=" + arguments.get("format", "all"), "GET")
    }

    if tool_name not in endpoints:
        return {"error": f"Unknown tool: {tool_name}"}

    path, method = endpoints[tool_name]
    full_url = f"{url}{path}"
    
    try:
        if method == "GET":
            req = urllib.request.Request(full_url)
        else:
            data = json.dumps(arguments).encode("utf-8")
            req = urllib.request.Request(full_url, data=data, headers={"Content-Type": "application/json"})
            
        with urllib.request.urlopen(req, timeout=15.0) as resp:
            content = resp.read().decode("utf-8")
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return {"text": content}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return {"error": json.loads(err_body), "status": e.code}
        except Exception:
            return {"error": err_body, "status": e.code}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        print(json.dumps(call_tool("aether_status"), indent=2))
    else:
        start_mcp_server()
