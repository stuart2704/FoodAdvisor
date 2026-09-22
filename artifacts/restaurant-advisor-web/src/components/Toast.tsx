import * as React from "react";
import type { Toast as ToastData } from "../hooks/use-toast";

type Props = {
  toast: ToastData;
  onClose: () => void;
};

export function Toast({ toast, onClose }: Props) {
  return (
    <div
      style={{
        background: "#222",
        color: "#fff",
        padding: "12px 16px",
        borderRadius: "6px",
        marginBottom: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        maxWidth: "320px"
      }}
    >
      {toast.title && (
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{toast.title}</div>
      )}
      {toast.description && (
        <div style={{ fontSize: "0.9rem", opacity: 0.9 }}>{toast.description}</div>
      )}
      <button
        onClick={onClose}
        style={{
          marginTop: 8,
          background: "#ff6b6b",
          border: "none",
          color: "#fff",
          padding: "4px 10px",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.8rem"
        }}
      >
        Close
      </button>
    </div>
  );
}