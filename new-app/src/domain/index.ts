/**
 * Domain Barrel Export
 * Public API of the domain layer
 */

// Entities
export * from './entities/person.js';
export * from './entities/task.js';

// Value Objects
export * from './value-objects/date-window.js';

// Services
export * from './services/task-services.js';
export * from './services/github-service.js';

// Ports (interfaces)
export * from './ports/repositories.js';

// Auto-Closure Configuration
export * from './entities/auto-closure-config.js';
export { AutoClosureService } from './services/auto-closure-service.js';
