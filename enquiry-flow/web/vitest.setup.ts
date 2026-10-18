import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest does not expose globals here, so React Testing Library cannot register
// its own cleanup — without this, each test would render into the previous one.
afterEach(() => cleanup());
