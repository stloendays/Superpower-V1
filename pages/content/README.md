# Content Scripts

This directory contains the content scripts and core functionality for the Superpower Chrome extension.

## Overview

The content scripts are responsible for:
- Injecting the MCP integration into supported websites
- Managing site-specific adapters
- Handling tool execution and result insertion
- Providing the plugin system architecture

## Architecture

### Plugin System (`src/plugins/`)
Modular plugin system that allows for site-specific functionality:

- **Core Registry**: Central plugin management and lifecycle
- **Base Classes**: Foundation for all adapter implementations  
- **Site Adapters**: Specialized implementations for different websites
- **Type System**: Complete TypeScript definitions
- **React Integration**: Hooks for component integration

### Adapters (`src/adapters/`)
Legacy adapter system that handles site-specific integrations:

- **Site Adapters**: Individual adapters for each supported platform
- **Common Components**: Shared functionality between adapters
- **Registry**: Central registration and management

### Components (`src/components/`)
React components and utilities:

- **UI Components**: Sidebar, notifications, controls
- **Website Handlers**: Site-specific input/output handling  
- **Core Components**: Shared functionality

### Other Directories

- **`src/events/`**: Event system for component communication
- **`src/hooks/`**: React hooks for adapter and plugin integration
- **`src/stores/`**: Zustand state management
- **`src/utils/`**: Utility functions and helpers
- **`src/types/`**: TypeScript type definitions

## Development

### Plugin System (New Architecture)

The new plugin system provides a clean, extensible architecture:

```typescript
// Example: Using a plugin adapter
import { useCurrentAdapter } from './hooks/useAdapter';

function MyComponent() {
  const { insertText, submitForm, hasCapability } = useCurrentAdapter();
  
  const handleInsert = () => {
    insertText('Hello World!');
  };
  
  return <button onClick={handleInsert}>Insert Text</button>;
}
```

### Adding New Site Support

1. **Create an Adapter**: Extend `BaseAdapterPlugin`
2. **Register the Adapter**: Add to the plugin registry
3. **Test Integration**: Verify functionality on the target site
4. **Document Usage**: Update relevant README files

For detailed development guides, see:
- [`src/plugins/README.md`](src/plugins/README.md) - Plugin system documentation
- [`src/plugins/adapters/README.md`](src/plugins/adapters/README.md) - Adapter development guide

## Implementation Status

### ✅ Completed
- **Plugin System Core** (Session 7)
- **DefaultAdapter** - Universal fallback
- **ExampleForumAdapter** - Site-specific example (Session 8)
- **Event System** - Real-time communication
- **React Integration** - Hooks and components

### 🔄 In Progress  
- **Testing Framework** - Unit and integration tests
- **Legacy Migration** - Moving from old adapter system

### 📋 Planned
- **Additional Site Adapters** - Reddit, GitHub, Twitter
- **Dynamic Loading** - Runtime adapter discovery
- **Performance Monitoring** - Metrics and optimization

## Testing

```bash
# Run tests (when implemented)
pnpm test

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## File Structure

```
src/
├── plugins/           # New plugin system (Session 7+)
│   ├── adapters/      # Site-specific adapters
│   ├── README.md      # Plugin system docs
│   └── ...
├── adapters/          # Legacy adapter system
├── components/        # React components
├── events/           # Event system
├── hooks/            # React hooks
├── stores/           # State management
├── utils/            # Utilities
└── types/            # Type definitions
```
