import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Filter, X, Loader2, Users, BookOpen, Award, 
  AlertCircle, Info, Link, ChevronLeft, ChevronRight, Menu, HelpCircle, ChevronDown 
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

// Static continent data (moved outside component to prevent recreation)
const CONTINENTS = [
  { id: 'Q15', name: 'Africa', code: 'africa' },
  { id: 'Q51', name: 'Antarctica', code: 'antarctica' },
  { id: 'Q48', name: 'Asia', code: 'asia' },
  { id: 'Q46', name: 'Europe', code: 'europe' },
  { id: 'Q49', name: 'North America', code: 'north_america' },
  { id: 'Q55643', name: 'Oceania', code: 'oceania' },
  { id: 'Q18', name: 'South America', code: 'south_america' }
];

// Static country data (moved outside component to prevent recreation)
const COUNTRIES = [
  { code: 'US', name: 'United States', continent: 'north_america' },
  { code: 'GB', name: 'United Kingdom', continent: 'europe' },
  { code: 'CA', name: 'Canada', continent: 'north_america' },
  { code: 'DE', name: 'Germany', continent: 'europe' },
  { code: 'FR', name: 'France', continent: 'europe' },
  { code: 'CN', name: 'China', continent: 'asia' },
  { code: 'JP', name: 'Japan', continent: 'asia' },
  { code: 'AU', name: 'Australia', continent: 'oceania' },
  { code: 'IN', name: 'India', continent: 'asia' },
  { code: 'BR', name: 'Brazil', continent: 'south_america' },
  { code: 'IT', name: 'Italy', continent: 'europe' },
  { code: 'ES', name: 'Spain', continent: 'europe' },
  { code: 'NL', name: 'Netherlands', continent: 'europe' },
  { code: 'SE', name: 'Sweden', continent: 'europe' },
  { code: 'CH', name: 'Switzerland', continent: 'europe' },
  { code: 'KR', name: 'South Korea', continent: 'asia' },
  { code: 'SG', name: 'Singapore', continent: 'asia' },
  { code: 'MX', name: 'Mexico', continent: 'north_america' },
  { code: 'ZA', name: 'South Africa', continent: 'africa' },
  { code: 'RU', name: 'Russia', continent: 'europe' },
  { code: 'IL', name: 'Israel', continent: 'asia' },
  { code: 'TR', name: 'Turkey', continent: 'asia' },
  { code: 'AR', name: 'Argentina', continent: 'south_america' },
  { code: 'NZ', name: 'New Zealand', continent: 'oceania' },
  { code: 'AT', name: 'Austria', continent: 'europe' },
  { code: 'BE', name: 'Belgium', continent: 'europe' },
  { code: 'DK', name: 'Denmark', continent: 'europe' },
  { code: 'NO', name: 'Norway', continent: 'europe' },
  { code: 'FI', name: 'Finland', continent: 'europe' },
  { code: 'PL', name: 'Poland', continent: 'europe' },
  { code: 'PT', name: 'Portugal', continent: 'europe' },
  { code: 'GR', name: 'Greece', continent: 'europe' },
  { code: 'IE', name: 'Ireland', continent: 'europe' },
  { code: 'CZ', name: 'Czech Republic', continent: 'europe' },
].sort((a, b) => a.name.localeCompare(b.name));

// Helper to get country code from institution object
const getCountryCode = (institution) => {
  if (!institution) return null;
  return institution.country_code || null;
};

// Helper to parse complex affiliations
const getAuthorAffiliationProfile = (authorData) => {
  // Default fallback if no affiliations exist
  const lastKnownInst = authorData.last_known_institutions?.[0];
  const fallback = {
    primary: {
      name: lastKnownInst?.display_name || 'Unknown',
      countryCode: getCountryCode(lastKnownInst)
    },
    all: lastKnownInst ? [{
      name: lastKnownInst.display_name,
      countryCode: getCountryCode(lastKnownInst),
      years: []
    }] : [] // Include last_known in 'all' for display consistency
  };

  if (!authorData.affiliations || authorData.affiliations.length === 0) {
    return fallback;
  }

  // 1. Find the most recent year in their data
  let maxYear = 0;
  authorData.affiliations.forEach(aff => {
    const latest = Math.max(...aff.years);
    if (latest > maxYear) maxYear = latest;
  });

  // 2. Filter for institutions active in that max year
  const currentAffiliations = authorData.affiliations.filter(aff => 
    aff.years.includes(maxYear)
  );

  if (currentAffiliations.length === 0) return fallback;

  // 3. Sort by tenure (total years affiliated) descending
  // This ensures the "Primary" institution is the one they are most established at
  currentAffiliations.sort((a, b) => b.years.length - a.years.length);

  // 4. Extract clean objects
  const formattedAffiliations = currentAffiliations.map(aff => {
    return {
      name: aff.institution.display_name,
      countryCode: getCountryCode(aff.institution),
      years: aff.years
    };
  });

  return {
    primary: formattedAffiliations[0], // The winner (for color/clustering)
    all: formattedAffiliations.slice(0, 3) // Top 3 (for display)
  };
};


const CollaborationExplorer = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // Initialize graphData from localStorage (restore session on reload)
  const [graphData, setGraphData] = useState(() => {
    if (typeof window === 'undefined') return { nodes: [], links: [] };
    try {
      const stored = localStorage.getItem('collab-explorer-graph-v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('[RESTORE] Loaded graph from localStorage:', parsed.nodes?.length, 'nodes');
        return parsed;
      }
    } catch (err) {
      console.warn('[RESTORE] Failed to parse stored graph:', err);
    }
    return { nodes: [], links: [] };
  });
  const [selectedNodeId, setSelectedNodeId] = useState(null); // Separate state for selection
  // Initialize expandedAuthors from localStorage
  const [expandedAuthors, setExpandedAuthors] = useState(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('collab-explorer-expanded-v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('[RESTORE] Loaded expandedAuthors from localStorage:', parsed.length, 'authors');
        return new Set(parsed);
      }
    } catch (err) {
      console.warn('[RESTORE] Failed to parse stored expandedAuthors:', err);
    }
    return new Set();
  });
  const [locationFilter, setLocationFilter] = useState({ continents: [], countries: [] });
  const [showUnknownInstitutions, setShowUnknownInstitutions] = useState(true);
  const [filters, setFilters] = useState({
    minCitations: 0,
    minCollaborations: 1,
    labelThreshold: 5, // Min collabs to show a label
    worksToFetch: 200, // Works to scan
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // State for sidebar toggle
  // Fix unknown affiliations state
  const [isFixingUnknowns, setIsFixingUnknowns] = useState(false);
  const [fixProgress, setFixProgress] = useState({ current: 0, total: 0 });
  // Mobile detection for bottom sheet vs sidebar selection
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  // Legend visibility with localStorage persistence
  const [showLegend, setShowLegend] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('legend-visible');
    if (stored !== null) return stored === 'true';
    return window.innerWidth >= 768; // Default: visible on desktop, hidden on mobile
  });

  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const wrapperRef = useRef(null); // Ref for the SVG container
  const institutionColorRef = useRef(d3.scaleOrdinal(d3.schemeCategory10)); // Store color scale in ref
  const fixingAbortRef = useRef(false); // Abort flag for fixing unknowns

  // Email for polite pool - increases rate limit
  const POLITE_EMAIL = 'user@academic-collab.app';
  
  // Determine API base URL - use proxy on Netlify, direct API on localhost
  const API_BASE = window.location.hostname === 'localhost' 
    ? 'https://api.openalex.org' 
    : '/api';

  // Effect to track window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Effect to persist legend visibility to localStorage
  useEffect(() => {
    localStorage.setItem('legend-visible', showLegend.toString());
  }, [showLegend]);

  // Effect to persist graph state to localStorage (debounced to avoid excessive writes)
  useEffect(() => {
    if (graphData.nodes.length === 0) return; // Don't save empty state
    const timer = setTimeout(() => {
      try {
        // Serialize nodes (strip D3-specific properties like x, y, vx, vy but keep fx, fy for pinned)
        const serializable = {
          nodes: graphData.nodes.map(n => ({
            id: n.id,
            name: n.name,
            institution: n.institution,
            countryCode: n.countryCode,
            group: n.group,
            expanded: n.expanded,
            count: n.count,
            totalCitations: n.totalCitations,
            worksCount: n.worksCount,
            citedByCount: n.citedByCount,
            affiliationsList: n.affiliationsList,
            affiliationAttempted: n.affiliationAttempted,
            orcid: n.orcid,
            // Preserve pinned positions
            fx: n.fx,
            fy: n.fy,
          })),
          links: graphData.links.map(l => ({
            source: typeof l.source === 'object' ? l.source.id : l.source,
            target: typeof l.target === 'object' ? l.target.id : l.target,
            value: l.value,
          })),
        };
        localStorage.setItem('collab-explorer-graph-v1', JSON.stringify(serializable));
        console.log('[PERSIST] Saved graph to localStorage:', serializable.nodes.length, 'nodes');
      } catch (err) {
        console.warn('[PERSIST] Failed to save graph:', err);
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [graphData]);

  // Effect to persist expandedAuthors to localStorage
  useEffect(() => {
    if (expandedAuthors.size === 0 && graphData.nodes.length === 0) return; // Don't save if truly empty
    try {
      localStorage.setItem('collab-explorer-expanded-v1', JSON.stringify([...expandedAuthors]));
    } catch (err) {
      console.warn('[PERSIST] Failed to save expandedAuthors:', err);
    }
  }, [expandedAuthors, graphData.nodes.length]);

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

      const affiliationProfile = getAuthorAffiliationProfile(authorData);

      // Get works to find collaborators
      const worksUrl = `${API_BASE}/works?filter=author.id:${authorId}&per-page=${filters.worksToFetch}&sort=cited_by_count:desc&mailto=${POLITE_EMAIL}`;
      const worksData = await fetchWithRetry(worksUrl);

      // Extract collaborators from works
      const collaboratorMap = new Map();
      
      (worksData.results || []).forEach(work => {
        work.authorships.forEach(authorship => {
          const collabId = authorship.author.id;
          if (collabId && collabId !== authorId) {
            const institutionObj = authorship.institutions?.[0];
            const institution = institutionObj?.display_name || 'Unknown';
            const countryCode = getCountryCode(institutionObj);
            const existing = collaboratorMap.get(collabId);
            if (existing) {
              existing.count += 1;
              existing.totalCitations += work.cited_by_count || 0;
              // If we previously had "Unknown" or missing country, try to update from this work
              if (existing.institution === 'Unknown' && institution !== 'Unknown') {
                existing.institution = institution;
                existing.countryCode = countryCode;
              }
              // If we now have a country code but didn't before, update it
              if (!existing.countryCode && countryCode) {
                existing.countryCode = countryCode;
              }
              // Update needsProfileFetch - only need fetch if still missing data
              existing.needsProfileFetch = existing.institution === 'Unknown' || !existing.countryCode;
            } else {
              collaboratorMap.set(collabId, {
                id: collabId,
                name: authorship.author.display_name || 'Unknown',
                count: 1,
                totalCitations: work.cited_by_count || 0,
                institution: institution,
                countryCode: countryCode,
                // Flag for smart mode: fetch profile if institution is unknown OR country code is missing
                needsProfileFetch: institution === 'Unknown' || !countryCode,
              });
            }
          }
        });
      });

      const collaborators = Array.from(collaboratorMap.values());

      // Log collaborator stats (unknowns will be fixed progressively after load)
      const unknownCount = collaborators.filter(c => c.needsProfileFetch).length;
      console.log(`[COLLABORATORS] Total: ${collaborators.length}, Unknown affiliations: ${unknownCount}`);

      return {
        author: {
          id: authorData.id,
          name: authorData.display_name,
          worksCount: authorData.works_count,
          citedByCount: authorData.cited_by_count,
          institution: affiliationProfile.primary.name,
          countryCode: affiliationProfile.primary.countryCode,
          // Used for UI Display (Array of up to 3)
          affiliationsList: affiliationProfile.all,
          orcid: authorData.orcid
        },
        collaborators: collaborators
      };
    } catch (err) {
      console.error('Error fetching collaborators:', err);
      throw err;
    }
  }, [filters.worksToFetch, API_BASE]);

  // Helper function to get continent for a country code
  const getContinentForCountry = useCallback((countryCode) => {
    if (!countryCode) return null;
    const country = COUNTRIES.find(c => c.code === countryCode);
    return country ? country.continent : null;
  }, []); // COUNTRIES is now stable (defined outside component)

  // Filter nodes based on location filter
  const getFilteredNodes = useCallback(() => {
    return graphData.nodes.filter(node => {
      // Always show expanded authors (main nodes)
      if (node.group === 'main' || node.expanded) {
        return true;
      }

      const nodeCountry = node.countryCode;
      const nodeContinent = getContinentForCountry(nodeCountry);
      // Location is unknown if we don't have a country code (regardless of institution name)
      const hasUnknownLocation = !nodeCountry || nodeCountry === null;

      // If no location filters are active, handle based on unknown institution preference
      if (locationFilter.continents.length === 0 && locationFilter.countries.length === 0) {
        // Only filter out if location is unknown AND user doesn't want to see unknowns
        if (hasUnknownLocation) {
          return showUnknownInstitutions;
        }
        return true;
      }

      // Location filters are active
      // If location is unknown, treat as "unknown" and respect the showUnknownInstitutions toggle
      if (hasUnknownLocation) {
        return showUnknownInstitutions;
      }

      // If country filter is active, check country
      if (locationFilter.countries.length > 0) {
        if (locationFilter.countries.includes(nodeCountry)) {
          return true;
        }
      }

      // If continent filter is active, check continent
      if (locationFilter.continents.length > 0) {
        if (nodeContinent && locationFilter.continents.includes(nodeContinent)) {
          return true;
        }
      }

      return false;
    });
  }, [graphData.nodes, locationFilter.continents, locationFilter.countries, getContinentForCountry, showUnknownInstitutions]);

  // Memoize filtered nodes to avoid recalculation on every render
  const filteredNodesData = React.useMemo(() => getFilteredNodes(), [getFilteredNodes]);

  // Toggle continent filter
  const toggleContinentFilter = (continentCode) => {
    setLocationFilter(prev => {
      const continents = prev.continents.includes(continentCode)
        ? prev.continents.filter(c => c !== continentCode)
        : [...prev.continents, continentCode];
      return { ...prev, continents };
    });
  };

  // Toggle country filter
  const toggleCountryFilter = (countryCode) => {
    setLocationFilter(prev => {
      const countries = prev.countries.includes(countryCode)
        ? prev.countries.filter(c => c !== countryCode)
        : [...prev.countries, countryCode];
      return { ...prev, countries };
    });
  };

  // Clear all location filters
  const clearLocationFilters = () => {
    setLocationFilter({ continents: [], countries: [] });
  };

  // Helper to close sidebar on mobile (screen width < 768px matches md: breakpoint)
  const closeSidebarOnMobile = useCallback(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Fix unknown affiliations progressively (fetches profiles one at a time with live updates)
  // refreshAll = false: only fix unknowns, refreshAll = true: update all unattempted collaborators
  const fixUnknownAffiliations = useCallback(async (refreshAll = false) => {
    // Get nodes to process based on mode
    const targetNodes = graphData.nodes.filter(
      n => n.group === 'collaborator' && 
           !n.affiliationAttempted && 
           (refreshAll || n.institution === 'Unknown' || !n.countryCode)
    );
    
    if (targetNodes.length === 0) {
      console.log('[FIX AFFILIATIONS] No affiliations to update');
      return;
    }
    
    console.log(`[FIX AFFILIATIONS] Starting to update ${targetNodes.length} affiliations (mode: ${refreshAll ? 'all' : 'unknowns'})`);
    setIsFixingUnknowns(true);
    setFixProgress({ current: 0, total: targetNodes.length });
    fixingAbortRef.current = false;
    
    for (let i = 0; i < targetNodes.length; i++) {
      // Check if abort was requested
      if (fixingAbortRef.current) {
        console.log(`[FIX AFFILIATIONS] Aborted at ${i}/${targetNodes.length}`);
        break;
      }
      
      const node = targetNodes[i];
      
      try {
        const collabUrl = `${API_BASE}/authors/${node.id}?mailto=${POLITE_EMAIL}`;
        const collabData = await fetchWithRetry(collabUrl);
        const collabProfile = getAuthorAffiliationProfile(collabData);
        
        // MUTATE the node directly to preserve D3 references
        node.institution = collabProfile.primary.name;
        node.countryCode = collabProfile.primary.countryCode;
        node.affiliationsList = collabProfile.all;
        node.affiliationAttempted = true; // Mark as attempted so we don't retry
        
        // Trigger re-render by updating graphData reference (but keeping same node objects)
        setGraphData(prevData => ({ ...prevData }));
        
        console.log(`[FIX AFFILIATIONS] Updated ${i + 1}/${targetNodes.length}: ${node.name} -> ${collabProfile.primary.name}`);
      } catch (err) {
        console.warn(`[FIX AFFILIATIONS] Failed to update ${node.name}:`, err.message);
        // Mark as attempted even on failure so we don't keep retrying
        node.affiliationAttempted = true;
        setGraphData(prevData => ({ ...prevData }));
      }
      
      // Update progress
      setFixProgress({ current: i + 1, total: targetNodes.length });
      
      // Delay between requests to respect rate limit (120ms = ~8 req/sec, safe for 10 req/sec limit)
      if (i < targetNodes.length - 1 && !fixingAbortRef.current) {
        await new Promise(res => setTimeout(res, 120));
      }
    }
    
    setIsFixingUnknowns(false);
    console.log('[FIX AFFILIATIONS] Finished updating affiliations');
  }, [graphData.nodes, API_BASE, POLITE_EMAIL]);

  // Stop fixing unknowns
  const stopFixingUnknowns = useCallback(() => {
    fixingAbortRef.current = true;
    console.log('[FIX UNKNOWNS] Stop requested');
  }, []);

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
      setShowLocationFilter(true); // Auto-expand location filter
      closeSidebarOnMobile(); // Close sidebar on mobile so user sees the graph
      
      // Auto-fix unknown affiliations after a brief delay (allows graph to render first)
      setTimeout(() => {
        // Check if there are unknowns to fix before starting (only unattempted ones)
        const hasUnknowns = collaborators.some(
          c => !c.affiliationAttempted && (c.institution === 'Unknown' || !c.countryCode)
        );
        if (hasUnknowns) {
          fixUnknownAffiliations(false); // Only fix unknowns on auto-start
        }
      }, 500);
    } catch (err) {
      console.error('Failed to load author data:', err);
      setError(`Failed to load author data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [expandedAuthors, filters.minCollaborations, filters.minCitations, fetchAuthorCollaborators, closeSidebarOnMobile, fixUnknownAffiliations]);

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

    // Get filtered data from memoized value
    const filteredNodes = filteredNodesData;
    // Compute filtered links inline (can't use useMemo inside useEffect)
    const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    });

    // Node size scale
    const sizeScale = d3.scaleSqrt()
      .domain([1, d3.max(filteredNodes, d => d.count) || 1])
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

      // Click background to clear selection
      svg.on('click', () => {
        setSelectedNodeId(null);
      });

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
    
    // Update nodes and links with filtered data
    simulation.nodes(filteredNodes);
    simulation.force('link').links(filteredLinks);

    // --- D3 Data Join (update, enter, exit) ---

    // Helper functions to pin/unpin nodes with consistent styling
    const pinNode = (d, element) => {
      // element should be the .node-group g element
      d3.select(element).select('.node-circle')
        .attr('stroke', '#64748b')
        .attr('stroke-dasharray', '4,2')
        .attr('stroke-width', 3);
    };

    const unpinNode = (d, element) => {
      d.fx = null;
      d.fy = null;
      simulation.alpha(0.3).restart();
      // element should be the .node-group g element
      d3.select(element).select('.node-circle')
        .attr('stroke', '#fff')
        .attr('stroke-dasharray', null)
        .attr('stroke-width', 2);
    };

    // Links
    const link = d3.select('.links-container')
      .selectAll('line.link')
      .data(filteredLinks, d => `${d.source.id}-${d.target.id}`);
    
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
      .data(filteredNodes, d => d.id);
    
    node.exit().remove();

    // Long-press tracking for mobile unpin
    let longPressTimer = null;

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
      .on('contextmenu', (event, d) => {
        // Right-click to unpin (desktop)
        event.preventDefault();
        event.stopPropagation();
        if (d.fx != null || d.fy != null) {
          unpinNode(d, event.currentTarget);
        }
      })
      .on('touchstart', (event, d) => {
        // Long-press to unpin (mobile)
        const targetElement = event.currentTarget;
        longPressTimer = setTimeout(() => {
          if (d.fx != null || d.fy != null) {
            unpinNode(d, targetElement);
          }
        }, 500);
      })
      .on('touchend', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      })
      .on('touchmove', () => {
        // Cancel long-press if user moves finger
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
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
      })
      .attr('stroke', d => (d.fx != null || d.fy != null) ? '#64748b' : '#fff')
      .attr('stroke-dasharray', d => (d.fx != null || d.fy != null) ? '4,2' : null)
      .attr('stroke-width', d => (d.fx != null || d.fy != null) ? 3 : 2);
    
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
    let dragStartX = 0;
    let dragStartY = 0;
    let wasDragged = false;
    let wasAlreadyPinned = false;
    const DRAG_THRESHOLD = 5; // Minimum pixels to consider it a drag

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.1).restart();
      dragStartX = d.x;
      dragStartY = d.y;
      wasDragged = false;
      // Remember if node was already pinned before this interaction
      wasAlreadyPinned = (d.fx != null || d.fy != null);
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
      // Check if moved beyond threshold
      const dx = event.x - dragStartX;
      const dy = event.y - dragStartY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        wasDragged = true;
      }
    }
    
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      
      if (wasDragged) {
        // Keep node pinned after drag and update styling
        const nodeElement = event.sourceEvent.target.parentNode;
        pinNode(d, nodeElement);
      } else if (!wasAlreadyPinned) {
        // Just a click on an unpinned node - don't pin it, release
        d.fx = null;
        d.fy = null;
      }
      // If wasAlreadyPinned and not dragged, keep it pinned (do nothing)
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

    // Restart simulation only if there are actual data changes
    // Use alpha(0.3) for gentler updates instead of alpha(0.8)
    simulation.alpha(0.3).restart();

    return () => {
      resizeObserver.disconnect();
      // Don't stop simulation, just let it run
    };
  }, [graphData.nodes, graphData.links, locationFilter.continents, locationFilter.countries, showUnknownInstitutions, filters.labelThreshold, addAuthorToGraph, selectedNodeId, getContinentForCountry, filteredNodesData]);


  const resetGraph = () => {
    setGraphData({ nodes: [], links: [] });
    setExpandedAuthors(new Set());
    setSelectedNodeId(null);
    // Clear persisted state from localStorage
    localStorage.removeItem('collab-explorer-graph-v1');
    localStorage.removeItem('collab-explorer-expanded-v1');
    console.log('[RESET] Cleared localStorage');
    closeSidebarOnMobile();
  };

  // Unpin all nodes
  const unpinAllNodes = () => {
    graphData.nodes.forEach(node => {
      node.fx = null;
      node.fy = null;
    });
    if (simulationRef.current) {
      simulationRef.current.alpha(0.3).restart();
    }
    // Update all node circle styles to unpinned state
    d3.selectAll('.node-circle')
      .attr('stroke', '#fff')
      .attr('stroke-dasharray', null)
      .attr('stroke-width', 2);
    // Force re-render to update button visibility
    setGraphData(prev => ({ ...prev }));
    closeSidebarOnMobile();
  };

  // Check if any nodes are pinned
  const hasPinnedNodes = graphData.nodes.some(node => node.fx != null || node.fy != null);

  // Undo expansion - remove an expanded author's collaborators (keep shared ones)
  const undoExpansion = useCallback((authorId) => {
    // Helper to get link endpoint ID (handles D3's object/string duality)
    const getLinkId = (endpoint) => typeof endpoint === 'object' ? endpoint.id : endpoint;

    setGraphData(prevData => {
      // Get all other expanded author IDs (excluding the one being undone)
      const otherExpandedIds = new Set(
        [...expandedAuthors].filter(id => id !== authorId)
      );

      // Only remove links where authorId is the SOURCE (i.e., links created by this expansion)
      // Keep links where authorId is the TARGET (i.e., links from other expanded authors to this node)
      const remainingLinks = prevData.links.filter(link => {
        const sourceId = getLinkId(link.source);
        // Remove links where this author was the expander (source)
        return sourceId !== authorId;
      });

      // Build set of node IDs still connected to other expanded authors
      const connectedToOthers = new Set();
      remainingLinks.forEach(link => {
        const sourceId = getLinkId(link.source);
        const targetId = getLinkId(link.target);
        // If source is an expanded author, target is connected
        if (otherExpandedIds.has(sourceId)) connectedToOthers.add(targetId);
        // Note: In our graph, expanded authors are always the source of their collaborator links
      });
      // Also add all other expanded authors themselves
      otherExpandedIds.forEach(id => connectedToOthers.add(id));

      // Process nodes - MUTATE existing node objects to preserve D3 references
      const remainingNodes = [];
      prevData.nodes.forEach(node => {
        if (node.id === authorId) {
          // The author being undone - check if connected as collaborator to other expanded authors
          if (connectedToOthers.has(authorId)) {
            // Demote to collaborator IN PLACE - recalculate count from remaining links
            const linkCount = remainingLinks.filter(l => 
              getLinkId(l.target) === authorId
            ).reduce((sum, l) => sum + (l.value || 1), 0);
            
            // Mutate existing node object to preserve D3 simulation references
            node.expanded = false;
            node.group = 'collaborator';
            node.count = linkCount;
            remainingNodes.push(node);
          }
          // If not connected to others, node is removed (not pushed)
        } else if (node.expanded || otherExpandedIds.has(node.id)) {
          // Keep all other expanded authors
          remainingNodes.push(node);
        } else if (connectedToOthers.has(node.id)) {
          // Keep collaborators still connected to other expanded authors
          remainingNodes.push(node);
        }
        // Orphaned collaborators are not pushed (removed)
      });

      return { nodes: remainingNodes, links: remainingLinks };
    });

    // Update expandedAuthors set
    setExpandedAuthors(prev => {
      const newSet = new Set(prev);
      newSet.delete(authorId);
      return newSet;
    });

    // Clear selection
    setSelectedNodeId(null);

    // Close sidebar on mobile so user sees the graph changes
    closeSidebarOnMobile();

    // Restart simulation
    if (simulationRef.current) {
      simulationRef.current.alpha(0.3).restart();
    }
  }, [expandedAuthors, closeSidebarOnMobile]);
  
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: parseInt(value) || 0
    }));
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Mobile: Hamburger menu button (only visible when sidebar closed) */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="fixed top-4 left-4 z-30 md:hidden bg-white p-2 rounded-lg shadow-lg border border-gray-300 hover:bg-gray-50"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6 text-gray-700" />
        </button>
      )}

      {/* Mobile: Backdrop overlay (only visible when sidebar open on mobile) */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-black bg-opacity-30 z-10"
        />
      )}

      {/* Sidebar */}
      <div className={`
        ${isSidebarOpen ? 'w-full md:w-80' : 'w-0'}
        fixed md:relative inset-y-0 md:inset-auto left-0 md:left-auto z-20 md:z-auto
        bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out
      `}>
        {/* Desktop: Edge toggle button (hidden on mobile) */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-20 w-8 h-16 bg-white border border-gray-300 rounded-r-lg items-center justify-center text-gray-500 hover:bg-gray-50 ${
            isSidebarOpen ? '-right-4' : 'left-0'
          }`}
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>

        {/* Mobile: Close button inside sidebar (only visible on mobile when open) */}
        {isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="md:hidden absolute top-4 right-4 z-30 text-gray-500 hover:text-gray-700"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        )}

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
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  // Only collapse if it's currently open and we're typing
                  if (e.target.value.trim() && showLocationFilter) {
                    setShowLocationFilter(false);
                  }
                }}
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

          {/* Location Filter - Prominent placement */}
          {graphData.nodes.length > 0 && (
            <div className="border-b border-gray-200">
              <button
                onClick={() => setShowLocationFilter(!showLocationFilter)}
                className="w-full p-4 bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-between hover:from-blue-100 hover:to-indigo-100 transition-colors"
              >
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  Location Filter
                </h3>
                <div className="flex items-center gap-2">
                  {(locationFilter.continents.length > 0 || locationFilter.countries.length > 0 || !showUnknownInstitutions) && (
                    <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                      {filteredNodesData.filter(n => n.group === 'collaborator').length}/{graphData.nodes.filter(n => n.group === 'collaborator').length}
                    </span>
                  )}
                  <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform ${
                    showLocationFilter ? 'rotate-90' : ''
                  }`} />
                </div>
              </button>
              
              {showLocationFilter && (
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50">
                  <div className="flex items-center justify-between mb-3">
                    {(locationFilter.continents.length > 0 || locationFilter.countries.length > 0) && (
                      <button
                        onClick={clearLocationFilters}
                        className="text-xs text-blue-600 hover:text-blue-800 underline ml-auto"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

              {/* Continents */}
              <div className="mb-3">
                <label className="text-xs font-medium text-gray-700 mb-2 block">Continents</label>
                <div className="flex flex-wrap gap-1.5">
                  {CONTINENTS.map(continent => (
                    <button
                      key={continent.code}
                      onClick={() => toggleContinentFilter(continent.code)}
                      className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                        locationFilter.continents.includes(continent.code)
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white text-gray-700 border border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                      }`}
                    >
                      {continent.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Countries */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-2 block">Countries</label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {COUNTRIES.filter(country => country.code !== 'IL').map(country => ( // Genocidal state exclusion
                    <button
                      key={country.code}
                      onClick={() => toggleCountryFilter(country.code)}
                      className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                        locationFilter.countries.includes(country.code)
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white text-gray-700 border border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                      }`}
                    >
                      {country.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggle for unknown institutions */}
              <div className="mt-3 pt-3 border-t border-blue-200">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showUnknownInstitutions}
                    onChange={(e) => setShowUnknownInstitutions(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">Show collaborators with unknown institutions</span>
                </label>
              </div>

              {/* Fix Unknown Affiliations Section */}
              {(() => {
                // Count unknowns (need fixing) and all unattempted (for update all)
                const unknownCount = graphData.nodes.filter(
                  n => n.group === 'collaborator' && 
                       !n.affiliationAttempted && 
                       (n.institution === 'Unknown' || !n.countryCode)
                ).length;
                const refreshableCount = graphData.nodes.filter(
                  n => n.group === 'collaborator' && !n.affiliationAttempted
                ).length;
                
                if (isFixingUnknowns) {
                  return (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-700 font-medium">
                          Updating affiliations... {fixProgress.current}/{fixProgress.total}
                        </span>
                        <button
                          onClick={stopFixingUnknowns}
                          className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                        >
                          Stop
                        </button>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${(fixProgress.current / fixProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                }
                
                if (unknownCount > 0) {
                  return (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <button
                        onClick={() => fixUnknownAffiliations(false)}
                        className="w-full text-xs px-3 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors flex items-center justify-center gap-2"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        Fix {unknownCount} Unknown Affiliations
                      </button>
                      {refreshableCount > unknownCount && (
                        <button
                          onClick={() => fixUnknownAffiliations(true)}
                          className="w-full mt-1.5 text-xs text-gray-500 hover:text-blue-600 underline"
                        >
                          Or update all {refreshableCount} to current
                        </button>
                      )}
                    </div>
                  );
                }
                
                if (refreshableCount > 0) {
                  return (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <button
                        onClick={() => fixUnknownAffiliations(true)}
                        className="w-full text-xs px-3 py-2 bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200 transition-colors flex items-center justify-center gap-2"
                      >
                        Update {refreshableCount} to Current Affiliations
                      </button>
                    </div>
                  );
                }
                
                return null;
              })()}

              {(locationFilter.continents.length > 0 || locationFilter.countries.length > 0 || !showUnknownInstitutions) && (
                <div className="mt-2 pt-2 border-t border-blue-100">
                  <p className="text-xs text-gray-600">
                    Showing {filteredNodesData.filter(n => n.group === 'collaborator').length} of {graphData.nodes.filter(n => n.group === 'collaborator').length} collaborators
                  </p>
                </div>
              )}
                </div>
              )}
            </div>
          )}

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
                const affiliationProfile = getAuthorAffiliationProfile(author);
                return (
                  <button
                    key={author.id}
                    onClick={() => addAuthorToGraph(author.id)}
                    className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-sm transition-all"
                  >
                    <div className="font-medium text-gray-900 text-sm">{author.display_name}</div>
                    <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                      {affiliationProfile.all.length > 0 ? (
                        affiliationProfile.all.map((aff, index) => (
                          <div key={index} className="flex items-start gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${index === 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                            <span className="truncate">{aff.name}</span>
                          </div>
                        ))
                      ) : (
                        <div className="truncate">{affiliationProfile.primary.name}</div>
                      )}
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
                <div className="text-xs text-gray-600 space-y-1 mt-1">
                        {selectedNode.affiliationsList && selectedNode.affiliationsList.length > 0 ? (
                          selectedNode.affiliationsList.map((aff, index) => (
                            <div key={index} className="flex items-start gap-1.5">
                               {/* Add a dot to indicate primary vs secondary */}
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${index === 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                              <span>{aff.name}</span>
                            </div>
                          ))
                        ) : (
                          // Fallback for collaborators (who don't have the rich profile data loaded yet)
                          <div className="flex items-start gap-1.5">
                             <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-blue-500" />
                             <span>{selectedNode.institution}</span>
                          </div>
                        )}
                      </div>
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
                {selectedNode.expanded && (
                  <button
                    onClick={() => undoExpansion(selectedNode.id)}
                    className="w-full mt-2 px-3 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 transition-colors border border-red-300"
                  >
                    Undo Expansion
                  </button>
                )}
              </div>
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="p-4 border-t border-gray-200 bg-gray-50 mt-auto">
              <div className="space-y-2">
                {hasPinnedNodes && (
                  <button
                    onClick={unpinAllNodes}
                    className="w-full px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 transition-colors border border-slate-300"
                  >
                    Unpin All Nodes
                  </button>
                )}
                <button
                  onClick={resetGraph}
                  className="w-full px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Reset Graph
                </button>
              </div>
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
              <p className="text-sm">Try searching for researchers like "Arkadas Ozakin" or "Miles Cranmer".</p>
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
        
        {/* Collapsible Legend */}
        {graphData.nodes.length > 0 && (
          <div className={`absolute left-4 transition-all duration-200 ${
            selectedNode && isMobile && !isSidebarOpen ? 'bottom-52' : 'bottom-4'
          }`}>
            {showLegend ? (
              <div className="bg-white p-4 rounded-lg shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-gray-700">Legend</h4>
                  <button
                    onClick={() => setShowLegend(false)}
                    className="text-gray-400 hover:text-gray-600 p-0.5"
                    aria-label="Collapse legend"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
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
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-gray-400 border-2 border-slate-500" style={{borderStyle: 'dashed'}}></div>
                    <span>Pinned Node</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
                  <p>• Click to view details</p>
                  <p>• Double-click to expand</p>
                  <p>• Drag to pin in place</p>
                  <p>• Right-click / long-press to unpin</p>
                  <p>• Scroll to zoom</p>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowLegend(true)}
                className="bg-white p-2.5 rounded-full shadow-lg hover:bg-gray-50 border border-gray-200"
                aria-label="Show legend"
              >
                <HelpCircle className="w-5 h-5 text-gray-600" />
              </button>
            )}
          </div>
        )}

        {/* Mobile Bottom Sheet - shows when node selected on mobile and sidebar is closed */}
        {selectedNode && isMobile && !isSidebarOpen && (
          <div className="fixed bottom-0 inset-x-0 z-30 bg-white rounded-t-2xl shadow-2xl border-t border-gray-200 p-4 pb-6 animate-slide-up">
            {/* Handle bar */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
            
            {/* Header row: Name + Close */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0 pr-2">
                <div className="font-semibold text-gray-900 text-base truncate">{selectedNode.name}</div>
              </div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-gray-400 hover:text-gray-600 p-1 -mr-1"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Affiliations list - dynamic height */}
            <div className="text-xs text-gray-600 space-y-1 mb-3">
              {selectedNode.affiliationsList && selectedNode.affiliationsList.length > 0 ? (
                selectedNode.affiliationsList.map((aff, index) => (
                  <div key={index} className="flex items-start gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${index === 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                    <span className="truncate">{aff.name}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-start gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-blue-500" />
                  <span className="truncate">{selectedNode.institution || 'Unknown Institution'}</span>
                </div>
              )}
            </div>
            
            {/* Inline stats */}
            <div className="flex items-center gap-3 text-xs text-gray-600 mb-3">
              {selectedNode.worksCount !== undefined && (
                <span className="flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  {selectedNode.worksCount}
                </span>
              )}
              {selectedNode.citedByCount !== undefined && (
                <span className="flex items-center gap-1">
                  <Award className="w-3.5 h-3.5" />
                  {selectedNode.citedByCount}
                </span>
              )}
              {selectedNode.count && (
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {selectedNode.count} collabs
                </span>
              )}
            </div>
            
            {/* Action button */}
            {!selectedNode.expanded ? (
              <button
                onClick={() => addAuthorToGraph(selectedNode.id)}
                disabled={loading}
                className="w-full px-4 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : 'Expand Collaborators'}
              </button>
            ) : (
              <button
                onClick={() => undoExpansion(selectedNode.id)}
                className="w-full px-4 py-2.5 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors border border-red-300"
              >
                Undo Expansion
              </button>
            )}
          </div>
        )}
      </div>

      {/* Small unobtrusive attribution footer */}
      <div className="absolute bottom-3 right-3 text-xs text-gray-500 bg-white bg-opacity-60 px-3 py-1 rounded-full shadow-sm hover:bg-opacity-80 transition-opacity pointer-events-auto">
        <a href="https://abdullahumuth.github.io" target="_blank" rel="noopener noreferrer" className="hover:underline">by abdullahumuth</a>
        <span className="mx-2 text-gray-300">•</span>
        <a href="https://github.com/abdullahumuth/academic_author_network" target="_blank" rel="noopener noreferrer" className="hover:underline">GitHub</a>
      </div>
    </div>
  );
};

export default CollaborationExplorer;
