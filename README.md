# GTA Map X & Vice Wire Blog

An interactive map platform and comprehensive content hub for GTA exploration, featuring interactive collectibles, landmarks, neighborhood guides, and the Vice Wire dynamic blog with admin management.

## 🌟 Key Features

- **Interactive GTA Map**: High-performance interactive map with custom tile sets, zoom controls, coordinates, and custom pins.
- **Marker Clustering & Performance**: Ultra-fast marker rendering powered by optimized Leaflet MarkerCluster with dynamic cluster radii.
- **Vice Wire Blog**:
  - Full-featured gaming blog with featured articles, categories, and tags.
  - Search, filter by category, and related article recommendations.
  - Admin management panel with keyword uniqueness validation to prevent duplicate keyword articles.
  - Dynamic API endpoints (`/api/blogs`) for fetching and managing blog posts.
- **Admin Management Panel**:
  - Dedicated admin dashboard (`/admin/`) to create, edit, draft, and publish articles.
  - Built-in keyword duplication checks and content validator.
- **PWA Ready**: Offline capabilities, web app manifest, and responsive design for mobile, tablet, and desktop.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- npm or bun

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd gta-map-x

# Install dependencies
npm install

# Start the development server
npm run dev
```

The application will be running at `http://localhost:3000`.

## 📁 Project Structure

```
├── admin/               # Admin dashboard for blog and article management
├── assets/              # Icons, map graphics, fonts, libraries, and images
├── data/                # Data files including articles and map points
├── blog.css / blog.js   # Vice Wire blog styling and dynamic scripts
├── features.js          # Core interactive map and feature handlers
├── index.html           # Main application interface and map viewport
├── server.js            # Express server and REST API endpoints
├── solmain2009.js       # Map engine and clustering manager
└── sw.js                # Service Worker for PWA support
```

## 🛠️ Tech Stack

- **Frontend**: Vanilla JS (ES6+), HTML5, CSS3, Leaflet, MarkerCluster
- **Backend**: Node.js, Express.js
- **Optimization**: Gzip compression, chunked tile rendering, caching
