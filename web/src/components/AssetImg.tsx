import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function AssetImg({
  projectId,
  url,
  alt,
  draggable,
}: {
  projectId: string;
  url: string;
  alt: string;
  draggable?: boolean;
}) {
  const [src, setSrc] = useState(url);

  useEffect(() => {
    let alive = true;
    api.resolveAsset(projectId, url).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [projectId, url]);

  return <img src={src} alt={alt} draggable={draggable} />;
}
