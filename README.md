# Proposal Decoder

A modern TypeScript project template with best practices and tooling configured.

## Features

- ✅ TypeScript 5.3+ with strict mode
- ✅ ESLint for code quality
- ✅ Prettier for code formatting
- ✅ Pre-configured build scripts
- ✅ Clean project structure

## Project Structure

```
proposal_decoder/
├── src/
│   └── index.ts          # Main entry point
├── dist/                 # Compiled output (generated)
├── .github/
│   └── copilot-instructions.md
├── .eslintrc.json        # ESLint configuration
├── .prettierrc           # Prettier configuration
├── .gitignore
├── package.json
├── tsconfig.json         # TypeScript configuration
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

Dependencies are already installed. If you need to reinstall:

```bash
npm install
```

### Development

Run the project in development mode with ts-node:

```bash
npm run dev
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Run

Execute the compiled JavaScript:

```bash
npm start
```

### Watch Mode

Automatically recompile on file changes:

```bash
npm run watch
```

### Code Quality

Lint your code:

```bash
npm run lint
```

Auto-fix linting issues:

```bash
npm run lint:fix
```

Format your code:

```bash
npm run format
```

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled application
- `npm run dev` - Run with ts-node for development
- `npm run watch` - Watch mode for automatic recompilation
- `npm run lint` - Check code with ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run format` - Format code with Prettier

## Configuration

### TypeScript

Edit [tsconfig.json](tsconfig.json) to customize TypeScript compiler options.

### ESLint

Modify [.eslintrc.json](.eslintrc.json) for linting rules.

### Prettier

Update [.prettierrc](.prettierrc) for formatting preferences.

## License

MIT
