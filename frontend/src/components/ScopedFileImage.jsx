import { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "@/App";

// Customer evidence (job photos, chat attachments) is served only through
// authenticated, scope-checked API routes. A plain <img src> cannot carry the
// session bearer token, so fetch the bytes with the shared axios client and
// render an object URL instead of pointing at a public file path.
const ScopedFileImage = ({ src, alt = "", className = "" }) => {
  const { token } = useAuth();
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    let active = true;
    let createdUrl = null;
    if (!src || !token) {
      setObjectUrl(null);
      return () => {};
    }
    axios
      .get(src, { headers: { Authorization: `Bearer ${token}` }, responseType: "blob" })
      .then((response) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(response.data);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (active) setObjectUrl(null);
      });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, token]);

  if (!objectUrl) {
    return <div className={`${className} bg-muted/40`} aria-hidden="true" />;
  }
  return <img src={objectUrl} alt={alt} className={className} />;
};

export default ScopedFileImage;
