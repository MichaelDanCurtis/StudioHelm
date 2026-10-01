import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export const PatchEdge = memo(function PatchEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath({ ...props, curvature: 0.43 });
  const draft = Boolean(props.data?.draft);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={24}
        style={props.style}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-pill ${draft ? "is-draft" : ""} ${props.selected ? "is-selected" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
          }}
        >
          <span className="edge-dot" />
          {draft ? "DRAFT" : props.data?.protocol === "OSC" ? "OSC" : "MIDI"}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
