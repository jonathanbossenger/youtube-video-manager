# youtube-video-manager

Desktop app to queue and schedule YouTube uploads for a single channel.

## Installation

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone https://github.com/jonathanbossenger/youtube-video-manager.git
cd youtube-video-manager
```

2. Install dependencies:
```bash
npm install
```

## Running

### Development

Start the development server with hot reload:
```bash
npm run dev
```

### Preview

Build the app and preview the production build:
```bash
npm run preview
```

### Production Build

Build the app for distribution:
```bash
npm run build
```

The built application will be in the `release/` directory.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run rebuild` - Rebuild native modules
- `npm run rebuild:sqlite` - Rebuild better-sqlite3 native module

## Troubleshooting

### `Error: Electron uninstall` when running `npm run dev`

This error means the Electron binary was not downloaded during `npm install` (for example due to a network failure, a proxy, or `--ignore-scripts`). The `postinstall` script runs the Electron binary installer automatically as part of `npm install`, but if it was skipped or failed, run it manually:

```bash
node node_modules/electron/install.js
```

Then retry `npm run dev`.