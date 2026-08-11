import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, Element, ElementLink } from "../api/client";

export default function RelationshipGraph({
  projectId,
  elements,
  links,
  onChange,
}: {
  projectId: string;
  elements: Element[];
  links: ElementLink[];
  onChange: () => Promise<void>;
}) {
  const initialNodes: Node[] = useMemo(
    () =>
      elements.map((el, i) => ({
        id: el.id,
        position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 120 },
        data: { label: el.title },
        style: {
          border: "1px solid #c5cec8",
          borderRadius: 8,
          padding: 8,
          background: "#fff",
          fontFamily: "Fraunces, serif",
        },
      })),
    [elements]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      links
        .filter(
          (l) =>
            elements.some((e) => e.id === l.from_element_id) &&
            elements.some((e) => e.id === l.to_element_id)
        )
        .map((l) => ({
          id: l.id,
          source: l.from_element_id,
          target: l.to_element_id,
          label: l.label || l.link_type,
        })),
    [links, elements]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const link = await api.createLink(projectId, {
        from_element_id: connection.source,
        to_element_id: connection.target,
        label: "related",
        link_type: "related",
      });
      setEdges((eds) =>
        addEdge(
          {
            id: link.id,
            source: link.from_element_id,
            target: link.to_element_id,
            label: link.label,
          },
          eds
        )
      );
      await onChange();
    },
    [projectId, onChange, setEdges]
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Relationship web</h2>
        <span className="muted">Drag between characters to link them</span>
        <button
          onClick={async () => {
            const edge = edges[edges.length - 1];
            if (!edge) return;
            await api.deleteLink(edge.id);
            setEdges((eds) => eds.slice(0, -1));
            await onChange();
          }}
        >
          Undo last link
        </button>
      </div>
      <div className="relationship-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {!elements.length && (
        <p className="muted">Create characters first, then open Relationships.</p>
      )}
    </div>
  );
}
