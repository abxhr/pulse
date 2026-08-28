import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS } from "../lib/format";
import { Modal, Loading } from "./primitives";

export default function Changelog({ open, onClose }) {
  const [text, setText] = useState(null);

  useEffect(() => {
    if (!open || text) return;
    fetch("/CHANGELOG.md").then((r) => r.text()).then(setText).catch(() => setText("Couldn't load changelog."));
  }, [open, text]);

  return (
    <Modal open={open} onClose={onClose} accent={COLORS.recovery} title="What's new" sub="version history">
      {!text ? <Loading label="Loading changelog…" /> : (
        <div className="md text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </Modal>
  );
}
