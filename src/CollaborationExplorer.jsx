import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Filter, X, Loader2, Users, BookOpen, Award, 
  AlertCircle, Info, Link, ChevronLeft, ChevronRight 
} from 'lucide-react';
import * as d3 from 'd3';

// Helper function for exponential backoff retry
const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 && retries > 0) {
        // Rate limited, wait and retry
        console.warn(`Rate limited. Retrying in ${delay / 1000}s...`);
        await new Promise(res => setTimeout(res, delay));
        return fetchWithRetry(url, retries - 1, delay * 2);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  } catch (err) {
    if (retries > 0 && err.message.includes('Failed to fetch')) {
      // Network error, wait and retry
      console.warn(`Network error. Retrying in ${delay / 1000}s...`);
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
    console.error('Fetch error:', err);
    throw err;
  }
};


const CollaborationExplorer = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNodeId, setSelectedNodeId] = useState(null); // Separate state for selection
  const [expandedAuthors, setExpandedAuthors] = useState(new Set());
  const [filters, setFilters] = useState({
    minCitations: 0,
    minCollaborations: 1,
    labelThreshold: 5, // Min collabs to show a label
    worksToFetch: 200, // Works to scan
  });
  const [showFilters, setShowFilters] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // State for sidebar toggle

  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const wrapperRef = useRef(null); // Ref for the SVG container
  const institutionColorRef = useRef(d3.scaleOrdinal(d3.schemeCategory10)); // Store color scale in ref

  // Email for polite pool - increases rate limit
  const POLITE_EMAIL = 'user@academic-collab.app';
  
  // Determine API base URL - use proxy on Netlify, direct API on localhost
  const API_BASE = window.location.hostname === 'localhost' 
    ? 'https://api.openalex.org' 
    : '/api';

  // Search for authors using OpenAlex
  const searchAuthors = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Use the appropriate API base (proxy or direct)
      const url = `${API_BASE}/authors?search=${encodeURIComponent(searchQuery)}&per-page=10&mailto=${POLITE_EMAIL}`;
      console.log('Searching:', url);

      const data = await fetchWithRetry(url);
      if (!data.results) throw new Error('Unexpected response format');
      setSearchResults(data.results || []);
      if (data.results.length === 0) {
        setError('No authors found. Try a different search term.');
      }
    } catch (err) {
      console.error('Search error:', err);
      setError(`Search failed: ${err.message}. Check console for details.`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch author details and collaborators
  const fetchAuthorCollaborators = useCallback(async (authorId) => {
    try {
      // Get author details
      const authorUrl = `${API_BASE}/authors/${authorId}?mailto=${POLITE_EMAIL}`;
      const authorData = await fetchWithRetry(authorUrl);

      // Get works to find collaborators
      const worksUrl = `${API_BASE}/works?filter=author.id:${authorId}&per-page=${filters.worksToFetch}&sort=cited_by_count:desc&mailto=${POLITE_EMAIL}`;
      const worksData = await fetchWithRetry(worksUrl);

      // Extract collaborators from works
      const collaboratorMap = new Map();
      
      (worksData.results || []).forEach(work => {
        work.authorships.forEach(authorship => {
          const collabId = authorship.author.id;
          if (collabId && collabId !== authorId) {
            const institution = (authorship.institutions && authorship.institutions[0]?.display_name) || 'Unknown';
            const existing = collaboratorMap.get(collabId);
            if (existing) {
              existing.count += 1;
              existing.totalCitations += work.cited_by_count || 0;
            } else {
              collaboratorMap.set(collabId, {
                id: collabId,
                name: authorship.author.display_name || 'Unknown',
                count: 1,
                totalCitations: work.cited_by_count || 0,
                institution: institution,
              });
            }
          }
        });
      });
      
      const getAuthorInstitution = (data) => {
        if (data.last_known_institutions && data.last_known_institutions[0]) {
          return data.last_known_institutions[0].display_name;
        }
        if (data.affiliations && data.affiliations[0]) {
          return data.affiliations[0].institution.display_name;
        }
        return 'Unknown';
      };

      return {
        author: {
          id: authorData.id,
          name: authorData.display_name,
          worksCount: authorData.works_count,
          citedByCount: authorData.cited_by_count,
          institution: getAuthorInstitution(authorData),
          orcid: authorData.orcid
        },
        collaborators: Array.from(collaboratorMap.values())
      };
    } catch (err) {
      console.error('Error fetching collaborators:', err);
      throw err;
    }
  }, [filters.worksToFetch, API_BASE]);


  // Add author to graph
  const addAuthorToGraph = useCallback(async (authorId) => {
    if (expandedAuthors.has(authorId)) return;
    
    setLoading(true);
    setError('');
    
    try {
      const { author, collaborators } = await fetchAuthorCollaborators(authorId);
      
      // Apply filters
      const filteredCollaborators = collaborators.filter(c => 
        c.count >= filters.minCollaborations &&
        c.totalCitations >= filters.minCitations
      );
      
      console.log(`Found ${collaborators.length} collaborators, ${filteredCollaborators.length} after filtering`);
      
      setExpandedAuthors(prev => new Set(prev).add(authorId));
      
      // Update graph data
      setGraphData(prevData => {
        const newNodes = [...prevData.nodes];
        const newLinks = [...prevData.links];
        
        // Add main author if not exists
        let authorNode = newNodes.find(n => n.id === author.id);
        if (!authorNode) {
          authorNode = {
            ...author,
            group: newNodes.length === 0 ? 'main' : 'expanded',
            expanded: true,
            x: wrapperRef.current ? wrapperRef.current.clientWidth / 2 : 300, // Start in center
            y: wrapperRef.current ? wrapperRef.current.clientHeight / 2 : 300,
          };
          newNodes.push(authorNode);
        } else {
          // Mark as expanded and update data
          authorNode.expanded = true;
          authorNode.group = 'expanded';
          Object.assign(authorNode, author); // Update with full details
        }
        
        // Add collaborators
        filteredCollaborators.forEach(collab => {
          if (!newNodes.find(n => n.id === collab.id)) {
            newNodes.push({
              ...collab,
              group: 'collaborator',
              expanded: false
            });
          }
          
          // Add link if not exists
          if (!newLinks.find(l => 
            (l.source === author.id || l.source.id === author.id) && 
            (l.target === collab.id || l.target.id === collab.id)
          )) {
            newLinks.push({
              source: author.id,
              target: collab.id,
              value: collab.count
            });
          }
        });
        
        return { nodes: newNodes, links: newLinks };
      });
      
      setSearchResults([]);
      setSelectedNodeId(authorId); // Select the newly added node
    } catch (err) {
      console.error('Failed to load author data:', err);
      setError(`Failed to load author data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [expandedAuthors, filters.minCollaborations, filters.minCitations, fetchAuthorCollaborators]);

  // Memoized getter for the selected node
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    return graphData.nodes.find(n => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphData.nodes]);


  // Effect for updating node selection styles (no physics change)
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    // Update node styles
    svg.selectAll('.node-group')
      .classed('selected', d => d.id === selectedNodeId)
      .transition().duration(200)
      .attr('opacity', d => (!selectedNodeId || d.id === selectedNodeId) ? 1.0 : 0.6);
    
    // Update link styles
    svg.selectAll('.link')
      .classed('selected', d => d.source.id === selectedNodeId || d.target.id === selectedNodeId)
      .transition().duration(200)
      .attr('stroke-opacity', d => {
        if (!selectedNodeId) return 0.5;
        return (d.source.id === selectedNodeId || d.target.id === selectedNodeId) ? 0.9 : 0.2;
      });

    // Update label visibility
    svg.selectAll('.node-label')
      .style('display', d => {
        if (d.id === selectedNodeId) return 'block';
        if (d.group !== 'collaborator' || d.expanded) return 'block';
        if (d.count >= filters.labelThreshold) return 'block';
        return 'none';
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, filters.labelThreshold]);


  // Initialize D3 visualization
  useEffect(() => {
    if (!svgRef.current || !wrapperRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = wrapperRef.current.clientWidth;
    const height = wrapperRef.current.clientHeight;
    svg.attr('width', width).attr('height', height);

    const institutionColor = institutionColorRef.current;

    // Node size scale
    const sizeScale = d3.scaleSqrt()
      .domain([1, d3.max(graphData.nodes, d => d.count) || 1])
      .range([8, 20]); // Min 8px, max 20px for collaborators

    const getNodeRadius = (d) => {
      if (d.group === 'main' || d.expanded) return 22;
      return sizeScale(d.count || 1);
    };

    // Calculate cluster centers
    const institutionGroups = [...new Set(graphData.nodes.map(n => n.institution))];
    const institutionPositions = new Map(institutionGroups.map((inst, i) => {
      const angle = (i / institutionGroups.length) * 2 * Math.PI;
      const radius = Math.min(width, height) / 3;
      return [inst, {
        x: width / 2 + radius * Math.cos(angle),
        y: height / 2 + radius * Math.sin(angle)
      }];
    }));

    // --- Create simulation if it doesn't exist ---
    if (!simulationRef.current) {
      const simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(d => 150 - (d.value * 5)).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-80).distanceMin(10))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => getNodeRadius(d) + 5))
        .force('x', d3.forceX(d => institutionPositions.get(d.institution)?.x || width / 2).strength(0.03))
        .force('y', d3.forceY(d => institutionPositions.get(d.institution)?.y || height / 2).strength(0.03))
        .alphaDecay(0.05);
      
      simulationRef.current = simulation;

      // --- Create static elements (containers, zoom) ---
      svg.selectAll('*').remove(); // Clear SVG
      const g = svg.append('g').attr('class', 'graph-container');

      const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });
      svg.call(zoom);

      g.append('g').attr('class', 'links-container');
      g.append('g').attr('class', 'nodes-container');

      simulation.on('tick', () => {
        g.selectAll('.link')
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        
        g.selectAll('.node-group')
          .attr('transform', d => `translate(${d.x},${d.y})`);
      });
    }

    // --- Update simulation data ---
    const simulation = simulationRef.current;
    
    // Update nodes and links
    simulation.nodes(graphData.nodes);
    simulation.force('link').links(graphData.links);

    // --- D3 Data Join (update, enter, exit) ---

    // Links
    const link = d3.select('.links-container')
      .selectAll('line.link')
      .data(graphData.links, d => `${d.source.id}-${d.target.id}`);
    
    link.exit().remove();

    link.enter().append('line')
      .attr('class', 'link')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', d => Math.sqrt(d.value) * 0.8)
      .merge(link);

    // Nodes
    const node = d3.select('.nodes-container')
      .selectAll('g.node-group')
      .data(graphData.nodes, d => d.id);
    
    node.exit().remove();

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNodeId(d.id); // Set selected ID
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        if (!d.expanded) {
          addAuthorToGraph(d.id);
        }
      })
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    nodeEnter.append('circle')
      .attr('class', 'node-circle')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);
    
    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', d => getNodeRadius(d) + 12)
      .attr('font-size', '10px')
      .attr('fill', '#374151')
      .style('pointer-events', 'none');

    nodeEnter.append('text')
      .attr('class', 'node-count')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
      .style('pointer-events', 'none');
    
    // Merge enter and update selections
    const nodeUpdate = node.merge(nodeEnter);

    nodeUpdate.select('.node-circle')
      .transition().duration(300)
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => {
        if (d.group === 'main') return '#3b82f6';
        if (d.expanded) return '#8b5cf6';
        return institutionColor(d.institution);
      });
    
    nodeUpdate.select('.node-label')
      .text(d => d.name.split(' ').slice(-1)[0]) // Show last name
      .attr('y', d => getNodeRadius(d) + 12)
      .style('display', d => {
        if (d.id === selectedNodeId) return 'block';
        if (d.group !== 'collaborator' || d.expanded) return 'block';
        if (d.count >= filters.labelThreshold) return 'block';
        return 'none';
      });

    nodeUpdate.select('.node-count')
      .text(d => d.count > 0 ? d.count : '')
      .style('display', d => (d.group === 'collaborator' && getNodeRadius(d) > 10) ? 'block' : 'none');
    
    // --- Drag Functions ---
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.1).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // --- Resize Observer ---
    const resizeObserver = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      svg.attr('width', width).attr('height', height);
      
      // Recalculate cluster centers
      const newPositions = new Map(institutionGroups.map((inst, i) => {
        const angle = (i / institutionGroups.length) * 2 * Math.PI;
        const radius = Math.min(width, height) / 3;
        return [inst, {
          x: width / 2 + radius * Math.cos(angle),
          y: height / 2 + radius * Math.sin(angle)
        }];
      }));

      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.force('x', d3.forceX(d => newPositions.get(d.institution)?.x || width / 2).strength(0.03));
      simulation.force('y', d3.forceY(d => newPositions.get(d.institution)?.y || height / 2).strength(0.03));

      simulation.alpha(0.3).restart(); // Reheat simulation on resize
    });
    
    resizeObserver.observe(wrapperRef.current);

    // Restart simulation
    simulation.alpha(0.8).restart();

    return () => {
      resizeObserver.disconnect();
      // Don't stop simulation, just let it run
    };
  }, [graphData, filters.labelThreshold, addAuthorToGraph, selectedNodeId]);


  const resetGraph = () => {
    setGraphData({ nodes: [], links: [] });
    setExpandedAuthors(new Set());
    setSelectedNodeId(null);
  };
  
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: parseInt(value) || 0
    }));
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      <div className={`
        ${isSidebarOpen ? 'w-80' : 'w-0'}
        bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out relative
      `}>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-8 h-16 bg-white border border-gray-300 rounded-r-lg flex items-center justify-center text-gray-500 hover:bg-gray-50"
        >
          {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>

        <div className={`
          flex-1 flex flex-col overflow-y-auto ${isSidebarOpen ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300
        `}>
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-gray-900 mb-2">Collaboration Explorer</h1>
            <p className="text-xs text-gray-500 mb-4 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>Powered by OpenAlex. Search authors and explore.</span>
            </p>
            
            <div className="relative mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchAuthors()}
                placeholder="Search for an author..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading}
              />
              <button
                onClick={searchAuthors}
                disabled={loading}
                className="absolute right-2 top-2 text-gray-400 hover:text-blue-500 disabled:opacity-50"
              >
                {loading && searchResults.length === 0 ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
              </button>
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <Filter className="w-4 h-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
          </div>

          {showFilters && (
            <div className="p-4 bg-gray-50 border-b border-gray-200 space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Min Citations (Collaborator)</label>
                <input
                  type="number"
                  value={filters.minCitations}
                  onChange={(e) => handleFilterChange('minCitations', e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Min Collaborations</label>
                <input
                  type="number"
                  value={filters.minCollaborations}
                  onChange={(e) => handleFilterChange('minCollaborations', e.target.value || 1)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Label Threshold (Min Collabs)</label>
                <input
                  type="number"
                  value={filters.labelThreshold}
                  onChange={(e) => handleFilterChange('labelThreshold', e.target.value || 5)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Works to Scan (e.g., 200)</label>
                <input
                  type="number"
                  step="50"
                  value={filters.worksToFetch}
                  onChange={(e) => handleFilterChange('worksToFetch', e.target.value || 200)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-red-700">Error</div>
                  <div className="text-xs text-red-600 mt-1">{error}</div>
                </div>
              </div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Search Results ({searchResults.length})</h3>
              {searchResults.map(author => {
                const institution = (author.last_known_institutions && author.last_known_institutions[0]?.display_name) ||
                                  (author.affiliations && author.affiliations[0]?.institution.display_name) ||
                                  'Unknown Institution';
                return (
                  <button
                    key={author.id}
                    onClick={() => addAuthorToGraph(author.id)}
                    className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-sm transition-all"
                  >
                    <div className="font-medium text-gray-900 text-sm">{author.display_name}</div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {institution}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3 h-3" />
                        {author.works_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <Award className="w-3 h-3" />
                        {author.cited_by_count || 0}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedNode && (
            <div className="p-4 border-t border-gray-200 bg-blue-50">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Selected Author</h3>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="font-medium text-gray-900 text-sm">{selectedNode.name}</div>
                <a
                  href={selectedNode.id}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <Link className="w-3 h-3" />
                  View on OpenAlex
                </a>
                {selectedNode.institution && (
                  <div className="text-xs text-gray-600">{selectedNode.institution}</div>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {selectedNode.worksCount !== undefined && (
                    <span className="px-2 py-1 bg-white rounded flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {selectedNode.worksCount} papers
                    </span>
                  )}
                  {selectedNode.citedByCount !== undefined && (
                    <span className="px-2 py-1 bg-white rounded flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      {selectedNode.citedByCount} citations
                    </span>
                  )}
                  {selectedNode.count && (
                    <span className="px-2 py-1 bg-white rounded flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {selectedNode.count} collaborations
                    </span>
                  )}
                </div>
                {!selectedNode.expanded && (
                  <button
                    onClick={() => addAuthorToGraph(selectedNode.id)}
                    disabled={loading}
                    className="w-full mt-2 px-3 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Loading...' : 'Expand Collaborators'}
                  </button>
                )}
              </div>
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="p-4 border-t border-gray-200 bg-gray-50 mt-auto">
              <button
                onClick={resetGraph}
                className="w-full px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
              >
                Reset Graph
              </button>
              <div className="mt-2 text-xs text-gray-500 text-center">
                {graphData.nodes.length} authors • {graphData.links.length} connections
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 relative" ref={wrapperRef}>
        <svg ref={svgRef} className="w-full h-full" />
        
        {graphData.nodes.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-gray-400 max-w-md px-4">
              <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Search for an author to start</p>
              <p className="text-sm">Try searching for researchers like "Geoffrey Hinton" or "Marie Curie".</p>
              <p className="text-xs mt-4 text-gray-400">
                💡 Double-click nodes to expand their collaborators
              </p>
            </div>
          </div>
        )}
        
        {loading && graphData.nodes.length > 0 && (
          <div className="absolute top-4 right-4 bg-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm text-gray-700">Loading collaborators...</span>
          </div>
        )}
        
        {graphData.nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-white p-4 rounded-lg shadow-lg pointer-events-none">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Legend</h4>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm"></div>
                <span>Starting Author</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-purple-500 border-2 border-white shadow-sm"></div>
                <span>Expanded Author</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-sm"></div>
                <span>Collaborator (by Institution)</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
              <p>• Click to view details</p>
              <p>• Double-click to expand</p>
              <p>• Drag to reposition</p>
              <p>• Scroll to zoom</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaborationExplorer;
