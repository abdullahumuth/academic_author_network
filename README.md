# Academic Author Network Graph View

**Live Demo:** [**authornetwork.netlify.app**](https://authornetwork.netlify.app/)

A dynamic data visualization tool that lets you explore the collaboration networks of academic authors. Search for a researcher and see their co-authors visualized in an interactive force-directed graph.

![demo](https://github.com/abdullahumuth/academic_author_network/blob/main/public/authornetworkdemo.jpg?raw=true) 

-----

<details>
<summary><strong>Recent Updates (Click to expand)</strong></summary>

### 07.12.2025
- **Progressive affiliation fixing:**
  - Added "Fix Unknown Affiliations" button to progressively fetch missing data in the background.
  - Live updates: nodes update in real-time as affiliations are fetched (~8 req/sec).
  - Stop button to abort the fixing process at any time.
  - Progress bar shows current/total affiliations being updated.
  - Auto-starts fixing unknowns after expanding an author.
- **Dual-mode affiliation updates:**
  - "Fix X Unknown Affiliations" button (amber) - only fetches profiles for unknowns.
  - "Or update all Y to current" link - refreshes all collaborator affiliations to their current data.
- **Session persistence (localStorage):**
  - Graph state automatically saved to localStorage (debounced 500ms).
  - Expanded authors list and pinned node positions (fx/fy) preserved across sessions.
  - State restored automatically on page reload—no data loss on refresh.
  - "Reset Graph" clears localStorage along with the graph.
- **Mobile UX improvements:**
  - Bottom sheet and sidebar selection are now mutually exclusive.
  - Tap node with sidebar closed → bottom sheet appears with author details and Undo Expansion.

### 04.12.2025
- **Improved institution affiliation accuracy:**
  - Now uses the `affiliations` API data for more accurate current institution detection.
  - Displays up to 3 current affiliations for authors.
- **Added "Undo Expansion" feature:**
  - Allows removing an expanded author's collaborators while keeping shared connections.
- **Added node pinning system:**
  - Drag nodes to pin them in place (indicated by dashed slate border).
  - Right-click or long-press (mobile) to unpin individual nodes.
  - "Unpin All Nodes" button to release all pinned nodes at once.

### 23.11.2025
- **Location-based filtering:**
  - Filter collaborators by continent and country.
  - Option to show/hide collaborators with unknown institutions.

</details>

## Features

  * **Interactive Graph:** Visualizes author networks using a D3.js force-directed graph.
  * **Session Persistence:** The graph state, including expanded authors and node positions, is automatically saved to local storage. Your research session survives page reloads and connection drops.
  * **Dynamic Expansion & Undo:**
      * **Expand:** Double-click any node to fetch their collaborators.
      * **Undo:** Use the "Undo Expansion" feature to remove a specific author's exclusive collaborators while maintaining shared connections within the graph.
  * **Pinning System:** Organize your view by dragging nodes to pin them in place. Right-click (or long-press on mobile) to unpin specific nodes, or unpin all at once.
  * **Smart Affiliation Data:**
      * **Intelligent Clustering:** Nodes are automatically clustered by their institution.
      * **Progressive Fixing:** Automatically or manually fetch missing institutional data in the background without freezing the UI.
      * **Dual-Mode Updates:** Choose to fix only unknown institutions or refresh all data to the latest API results.
  * **Deep Filtering:** A collapsible sidebar allows you to filter by:
      * **Geography:** Continent and Country (Location-based filtering).
      * **Metrics:** Minimum citations, collaboration counts, and label thresholds.
      * **Data Quality:** Toggle visibility for authors with unknown institutions.
  * **Mobile-Optimized:** Features a responsive design with a bottom-sheet interface for mobile users, ensuring smooth navigation on smaller screens.

## Tech Stack

  * **Frontend:** React (Hooks, Context)
  * **Data Visualization:** D3.js (v7)
  * **Styling:** Tailwind CSS (via CDN)
  * **Icons:** Lucide React
  * **API:** [OpenAlex API](https://openalex.org/)
  * **Deployment:** Netlify (using Netlify Functions for API proxying)

## How to Use

1.  **Search:** Type the name of an author (e.g., "Miles Cranmer") into the search bar.
2.  **Select:** Click an author from the search results to initialize the graph.
3.  **Explore & Organize:**
      * **Expand:** Double-click a node to load its collaborators.
      * **Pin:** Drag any node to lock it in place (useful for organizing clusters).
      * **Unpin:** Right-click a pinned node (or use the UI button) to release it.
      * **Details:** Click a node to view detailed metrics and up to 3 current affiliations.
4.  **Manage Data:**
      * If you see "Unknown Affiliation" nodes, use the **"Fix Unknowns"** button in the sidebar to resolve them in the background.
      * Use **"Undo Expansion"** on a selected node to clean up the graph if it becomes too cluttered.
5.  **Filter:** Open the "Show Filters" panel to refine the graph by location, citation count, or connection strength.

## Running Locally

To run this project on your local machine:

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Set up the Netlify proxy:**
    This project is configured to use a Netlify proxy (`netlify.toml`) to handle OpenAlex API requests and avoid CORS errors. The easiest way to run this locally is with the Netlify CLI.

    ```bash
    # Install the Netlify CLI (if you haven't already)
    npm install -g netlify-cli

    # Run the project with the proxy
    netlify dev
    ```

4.  Your browser will automatically open to `http://localhost:8888` (or a similar port) with the app and the API proxy running.
