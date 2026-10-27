/**
 * Dependency graph: the notebook DAG rendered with React Flow. Clicking a
 * node selects the block in the editor; dependent blocks (downstream) are
 * highlighted, matching the reactive execution mode.
 */

import { Box, Text } from '@chakra-ui/react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';

import type { DagModel, NotebookModel } from '../protocol';

const TYPE_COLORS: Record<string, string> = {
  code: '#3182ce',
  sql: '#38a169',
  markdown: '#718096',
  agent: '#805ad5',
};

interface BlockNodeData {
  label: string;
  type: string;
  selected: boolean;
  feedsSelection: boolean;
}

function BlockNode({ data }: NodeProps) {
  const d = data as unknown as BlockNodeData;
  return (
    <Box
      bg={d.selected ? 'accent.100' : d.feedsSelection ? 'teal.50' : 'white'}
      borderWidth="2px"
      borderColor={TYPE_COLORS[d.type] ?? '#a0aec0'}
      borderRadius="md"
      px={3}
      py={1.5}
      minW={110}
      textAlign="center"
      fontSize="xs"
      fontWeight={d.selected ? 'bold' : 'normal'}
      shadow="sm"
    >
      <Handle type="target" position={Position.Left} />
      <Text noOfLines={1}>{d.label}</Text>
      <Text color="gray.500" fontSize="2xs">
        {d.type}
      </Text>
      <Handle type="source" position={Position.Right} />
    </Box>
  );
}

const nodeTypes = { block: BlockNode };

function layout(notebook: NotebookModel, dag: DagModel, selectedBlockId: string | null) {
  // Layered left-to-right by longest incoming path (small graphs: simple BFS depth).
  const depth = new Map<string, number>();
  for (const node of notebook.blocks) depth.set(node.id, 0);
  for (let pass = 0; pass < notebook.blocks.length; pass += 1) {
    for (const edge of dag.edges) {
      const from = depth.get(edge.from) ?? 0;
      const to = depth.get(edge.to) ?? 0;
      if (to <= from) depth.set(edge.to, from + 1);
    }
  }
  const rowsByDepth = new Map<number, number>();
  const nodes = notebook.blocks.map((block) => {
    const d = depth.get(block.id) ?? 0;
    const row = rowsByDepth.get(d) ?? 0;
    rowsByDepth.set(d, row + 1);
    return {
      id: block.id,
      type: 'block',
      position: { x: d * 260, y: row * 110 },
      data: {
        label: block.content.split('\n')[0]?.slice(0, 28) || block.type,
        type: block.type,
        selected: block.id === selectedBlockId,
        feedsSelection: Boolean(
          selectedBlockId && (dag.downstream[selectedBlockId] ?? []).includes(block.id),
        ),
      },
    };
  });

  const downstreamOfSelection = new Set(
    selectedBlockId ? (dag.downstream[selectedBlockId] ?? []) : [],
  );
  const edges = dag.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    animated: Boolean(selectedBlockId && downstreamOfSelection.has(edge.to)),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#a0aec0' },
  }));

  return { nodes, edges };
}

export function DagGraph({
  notebook,
  dag,
  selectedBlockId,
  onSelect,
}: {
  notebook: NotebookModel;
  dag: DagModel;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => layout(notebook, dag, selectedBlockId),
    [notebook, dag, selectedBlockId],
  );

  if (dag.edges.length === 0) {
    return (
      <Text color="gray.500" fontSize="sm">
        No data dependencies between blocks yet (they appear when blocks share variables).
      </Text>
    );
  }

  return (
    <Box h="420px" borderRadius="md" borderWidth="1px" borderColor="gray.200">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_event, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </Box>
  );
}
