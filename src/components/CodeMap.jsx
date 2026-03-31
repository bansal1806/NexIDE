import { useEffect, useRef, useCallback, useState, memo } from 'react';
import * as d3 from 'd3';
import { parseCode, parseProjectMap } from '../utils/codeParser';
import { RefreshCw, Layout, FileCode2 } from 'lucide-react';

const NODE_COLORS = {
  import:    '#f59e0b',
  function:  '#00d4ff',
  class:     '#a855f7',
  component: '#10b981',
  variable:  '#f97316',
  folder:    '#7c3aed',
  default:   '#8b8fa8',
};

const NODE_ICONS = {
  import:    '📦',
  function:  'ƒ',
  class:     '◆',
  component: '📄',
  folder:    '📁',
  variable:  'x',
};

export const CodeMap = memo(function CodeMap({ activeTab, tabs, fileTree = [], onNodeClick }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const simRef = useRef(null);
  const [mapType, setMapType] = useState('file'); // 'file' | 'project'

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!svgRef.current || !containerRef.current) return;

    const { nodes, edges } = mapType === 'project'
      ? parseProjectMap(fileTree)
      : parseCode(activeTab?.content, activeTab?.lang);

    if (nodes.length === 0) return;

    const width  = containerRef.current.clientWidth  || 400;
    const height = containerRef.current.clientHeight || 300;

    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Background
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent');

    // Defs: markers
    const defs = svg.append('defs');
    
    // Grid pattern
    const pattern = defs.append('pattern')
      .attr('id', 'map-grid')
      .attr('width', 40)
      .attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');
    
    pattern.append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', '#1a1b26')
      .attr('stroke-width', 1);

    // Background rect with grid
    svg.append('rect')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('fill', 'url(#map-grid)');

    
    // Structural arrow
    defs.append('marker')
      .attr('id', 'arrow-structural')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', '#3d3f57');

    // Dependency arrow (more prominent)
    defs.append('marker')
      .attr('id', 'arrow-dependency')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', '#6c63ff');

    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        // Fade the grid as we zoom out
        svg.select('#map-grid path').attr('opacity', Math.min(1, event.transform.k));
      });
    svg.call(zoom);

    // sim links
    const linkData = edges.map(e => ({
      source: nodes[e.source],
      target: nodes[e.target],
    }));

    // Force simulation
    simRef.current = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(linkData)
        .id(d => d.id)
        .distance(d => d.type === 'dependency' ? 140 : 80)
        .strength(0.4)
      )
      .force('charge', d3.forceManyBody().strength(-250))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => (d.size || 20) + 15))
      .force('x', d3.forceX(width / 2).strength(0.08))
      .force('y', d3.forceY(height / 2).strength(0.08));

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(linkData)
      .join('line')
        .attr('stroke', d => d.type === 'dependency' ? '#6c63ff88' : '#2a2b3d')
        .attr('stroke-width', d => d.type === 'dependency' ? 1 : 1.5)
        .attr('stroke-dasharray', d => d.type === 'dependency' ? '4,4' : '0')
        .attr('marker-end', d => d.type === 'dependency' ? 'url(#arrow-dependency)' : 'url(#arrow-structural)');

    // Animate dependency links
    g.selectAll('line')
      .filter(d => d.type === 'dependency')
      .append('animate')
        .attr('attributeName', 'stroke-dashoffset')
        .attr('from', 50)
        .attr('to', 0)
        .attr('dur', '2s')
        .attr('repeatCount', 'indefinite');

    // Node groups
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
        .attr('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', d => `${d.type}: ${d.name}`)
        .on('click', (event, d) => {
          if (onNodeClick) onNodeClick(d);
        });

    // Drag behavior
    const drag = d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simRef.current.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simRef.current.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // Node circles
    node.append('circle')
      .attr('r', d => d.size || 20)
      .attr('fill', d => `${NODE_COLORS[d.type] || NODE_COLORS.default}22`)
      .attr('stroke', d => NODE_COLORS[d.type] || NODE_COLORS.default)
      .attr('stroke-width', 1.5)
      .style('transition', 'all 0.15s');

    // Hover effect
    node.on('mouseenter', function(event, d) {
        d3.select(this).select('circle')
          .attr('r', (d.size || 20) + 3)
          .attr('fill', `${NODE_COLORS[d.type] || NODE_COLORS.default}44`);
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).select('circle')
          .attr('r', d.size || 20)
          .attr('fill', `${NODE_COLORS[d.type] || NODE_COLORS.default}22`);
      });

    // Node icons
    node.append('text')
      .text(d => NODE_ICONS[d.type] || '·')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => d.type === 'function' ? '14px' : '11px')
      .attr('fill', d => NODE_COLORS[d.type] || NODE_COLORS.default)
      .attr('font-family', 'var(--font-mono)')
      .style('user-select', 'none')
      .style('pointer-events', 'none');

    // Node labels
    node.append('text')
      .text(d => d.name.length > 14 ? d.name.slice(0, 12) + '…' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', 30)
      .attr('font-size', '9px')
      .attr('fill', '#8b8fa8')
      .attr('font-family', 'var(--font-mono)')
      .style('user-select', 'none')
      .style('pointer-events', 'none');

    // Line badge (line number or path)
    node.append('text')
      .text(d => d.line ? `:${d.line}` : '')
      .attr('text-anchor', 'middle')
      .attr('dy', 40)
      .attr('font-size', '8px')
      .attr('fill', '#565870')
      .attr('font-family', 'var(--font-mono)')
      .style('user-select', 'none')
      .style('pointer-events', 'none');

    // Tick
    simRef.current.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Fade in
    g.style('opacity', 0)
      .transition()
      .duration(300)
      .style('opacity', 1);

  }, [activeTab, mapType, fileTree, onNodeClick]);

  useEffect(() => {
    render();
    return () => { if (simRef.current) simRef.current.stop(); };
  }, [render]);

  const { nodes } = mapType === 'project'
    ? parseProjectMap(tabs)
    : parseCode(activeTab?.content, activeTab?.lang);
  const isEmpty = nodes.length === 0;

  return (
    <div className="code-map" id="code-map-panel">
      <div className="code-map-toolbar">
        <span className="code-map-label">Code Map</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {!isEmpty && `${nodes.length} node${nodes.length !== 1 ? 's' : ''}`}
        </span>
        <button
          className={`btn-icon ${mapType === 'file' ? 'active' : ''}`}
          onClick={() => setMapType('file')}
          title="File AST Map"
        ><FileCode2 size={12} /></button>
        <button
          className={`btn-icon ${mapType === 'project' ? 'active' : ''}`}
          onClick={() => setMapType('project')}
          title="Project Map"
        ><Layout size={12} /></button>
        <button
          id="btn-refresh-map"
          className="btn-icon"
          onClick={render}
          aria-label="Refresh code map"
          title="Refresh map"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="code-map-svg-wrap" ref={containerRef}>
        {isEmpty ? (
          <div className="code-map-empty">
            <span className="code-map-empty-icon">🗺</span>
            <span>Write some code to see the map</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Functions, classes, and imports appear here
            </span>
          </div>
        ) : (
          <svg ref={svgRef} style={{ width: '100%', height: '100%' }} aria-label={`Code map with ${nodes.length} nodes`} />
        )}
      </div>

      <div className="code-map-legend" aria-label="Legend">
        {Object.entries(NODE_COLORS).filter(([k]) => k !== 'default').map(([type, color]) => (
          <div key={type} className="legend-item">
            <div className="legend-dot" style={{ background: color }} aria-hidden="true" />
            <span>{type}</span>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Drag · Scroll to zoom</span>
      </div>
    </div>
  );
});
