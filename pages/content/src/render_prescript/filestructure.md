# New File Structure

## Core Directories

- **src/**
  - **core/** - Core functionality
    - **config.ts** - Configuration interface and defaults
    - **types.ts** - Shared type definitions
  - **renderer/** - Rendering components
    - **index.ts** - Main renderer exports
    - **functionBlock.ts** - Function block rendering logic
    - **components.ts** - UI components for rendering
    - **styles.ts** - Styling for rendered components
  - **parser/** - Content parsing
    - **index.ts** - Main parser exports
    - **functionParser.ts** - Function call parsing logic
    - **parameterParser.ts** - Parameter extraction logic
    - **languageParser.ts** - Language tag detection
  - **observer/** - DOM observation
    - **index.ts** - Main observer exports
    - **mutationObserver.ts** - Mutation observer setup
    - **streamObserver.ts** - Streaming content observation
    - **stalledStreamHandler.ts** - Stalled stream detection and handling
  - **utils/** - Utility functions
    - **index.ts** - Main utility exports
    - **dom.ts** - DOM manipulation utilities
    - **performance.ts** - Performance-related utilities
  - **index.ts** - Library entry point

## Organizational Improvements

1. **Modular Structure**: Each directory contains related functionality, making the codebase more maintainable.

2. **Clean Separation of Concerns**:
   - Configuration management
   - DOM observation
   - Content parsing
   - UI rendering
   - Utility functions

3. **Improved Imports**:
   - Each directory has an index.ts file that re-exports the important parts of its modules
   - This keeps imports clean (e.g., `import { FunctionInfo } from '../parser'`)

4. **Type Definitions**:
   - Centralized in core/types.ts
   - Improves type safety across the codebase

5. **State Management**:
   - Each module manages its own state
   - Global state is properly encapsulated and exported as needed

This reorganization preserves all functionality while making the codebase more scalable and maintainable. 