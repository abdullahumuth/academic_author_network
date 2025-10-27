# Academic Author Network Graph View

**Live Demo:** [**authornetwork.netlify.app**](https://authornetwork.netlify.app/)

A dynamic data visualization tool that lets you explore the collaboration networks of academic authors. Search for a researcher and see their co-authors visualized in an interactive force-directed graph.

![demo](https://github.com/abdullahumuth/academic_author_network/blob/main/public/authornetworkdemo.jpg?raw=true)

-----

## Features

  * **Interactive Graph:** Visualizes author networks using a D3.js force-directed graph.
  * **Dynamic Expansion:** Start with one author and expand the graph by double-clicking any node to fetch their collaborators.
  * **Intelligent Clustering:** Nodes are automatically clustered by their institution, making it easy to spot institutional groupings.
  * **Data-Driven Sizing:** Node size directly corresponds to the number of collaborations with the central author.
  * **Detailed Info:** Click any node to view detailed information, including their name, institution, total papers, citation count, and a direct link to their OpenAlex profile.
  * **Powerful Filtering:** A collapsible sidebar allows you to filter the graph by:
      * Minimum citations for a collaborator
      * Minimum number of collaborations
      * Number of papers to scan (to find more collaborators for "big names")
      * Label threshold (to only show names for significant co-authors)
  * **Responsive & Resilient:** The app is fully responsive and features a robust `fetchWithRetry` mechanism to handle API rate limits.

## Tech Stack

  * **Frontend:** React (Hooks, Context)
  * **Data Visualization:** D3.js (v7)
  * **Styling:** Tailwind CSS (via CDN)
  * **Icons:** Lucide React
  * **API:** [OpenAlex API](https://openalex.org/)
  * **Deployment:** Netlify (using Netlify Functions for API proxying)

## How to Use

1.  **Search:** Type the name of an author (e.g., "Miles Cranmer") into the search bar.
2.  **Select:** Click an author from the search results to add them to the graph.
3.  **Explore:**
      * **Click** a node to see their details.
      * **Double-click** a node to expand it and load its collaborators.
      * **Drag** nodes to reposition them.
      * **Scroll** to zoom in and out.
4.  **Filter:** Open the "Show Filters" panel to refine the graph and reduce clutter.

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
