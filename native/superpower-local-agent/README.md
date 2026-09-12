# Superpower Local Agent

A C++20 + Qt 6 desktop companion for Superpower. It gives the browser extension a small, local-only memory of useful file and directory locations without injecting a full computer directory tree into the AI context.

## What v0.1 does

- remembers aliases for existing files and directories in SQLite
- searches only remembered locations and explicitly approved search roots
- resolves natural short references such as `catalyst` to a remembered path
- opens an approved local file or directory with the operating system
- receives ephemeral browser/agent messages in a dedicated Qt desktop GUI
- mirrors MCP tool start/completion state to the GUI without copying tool arguments or result bodies
- exposes the local agent to Chrome through Native Messaging

## Safety boundary

The local agent is intentionally narrow in v0.1.

- no full-disk scan by default
- no arbitrary shell command execution
- no delete, overwrite, rename, or move actions
- `memory.remember`, `memory.add_root`, and `file.open` require explicit approval
- approval is checked in both the browser bridge and the C++ core
- paths outside remembered locations and approved search roots cannot be opened through the agent
- GUI notifications are ephemeral and are not written to the SQLite memory database

## Architecture

```text
ChatGPT / Gemini / supported AI webpage
                |
       Superpower extension
                |
        Native Messaging
                |
      superpower-local-agent
          /             \
  SQLite memory      QLocalSocket
          |               |
   FileLocator      Desktop message GUI
                          |
                 superpower-local-gui
```

## Build on Windows

Requirements:

- CMake 3.24+
- Visual Studio 2022 C++ toolchain
- Qt 6.5+ with Core, Widgets, Sql, and Network

Example:

```powershell
cmake -S native/superpower-local-agent -B build/local-agent -G "Visual Studio 17 2022" -A x64 -DCMAKE_PREFIX_PATH=C:/Qt/6.8.3/msvc2022_64
cmake --build build/local-agent --config Release --parallel
$env:PATH = "C:\Qt\6.8.3\msvc2022_64\bin;$env:PATH"
$env:QT_PLUGIN_PATH = "C:\Qt\6.8.3\msvc2022_64\plugins"
ctest --test-dir build/local-agent -C Release --output-on-failure
```

GitHub Actions also builds both executables, runs the core smoke test, deploys the Qt runtime, and publishes a Windows artifact.

## Register Chrome Native Messaging

After building/deploying the host, run:

```powershell
powershell -ExecutionPolicy Bypass -File native/superpower-local-agent/install/windows/install-native-host.ps1 -ExtensionId <your-extension-id> -HostExe <path-to-superpower-local-agent.exe>
```

The installer registers `com.superpower.local_agent` for the current Windows user. Restart Chrome after registration.

## Desktop GUI

Run `superpower-local-gui.exe` to open the local message center.

Useful local commands:

```text
/remember catalyst = D:\Research\Catalyst
/find stage2-report
/open catalyst
/root D:\Research
/list
```

The **Remember folder** and **Add search root** buttons provide the same actions without typing paths manually.

## Native request examples

Remembering a location requires approval:

```json
{
  "action": "memory.remember",
  "args": {
    "alias": "catalyst",
    "path": "D:\\Research\\Catalyst",
    "approved": true
  }
}
```

Searching is read-only:

```json
{
  "action": "file.search",
  "args": {
    "query": "stage2-report",
    "max_results": 20
  }
}
```

Sending a transient GUI message does not persist the message:

```json
{
  "action": "gui.notify",
  "args": {
    "source": "ChatGPT",
    "role": "Tool",
    "kind": "status",
    "text": "Using GitHub search_repository…"
  }
}
```

## Next steps

- mirror finalized assistant messages through existing site adapters/observers without adding a polling loop
- add explicit desktop-GUI enable/disable preference
- add a proper Windows installer that deploys the Qt runtime and registers the Native Messaging host in one step
- later add narrowly scoped file operations with per-action approval and audit history
