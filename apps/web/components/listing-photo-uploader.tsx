"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./listing-photo-uploader.module.css";

type MediaItem = {
  id: string;
  publicUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isCover: boolean;
  status: string;
  altText: string | null;
  localPreview?: string;
  progress?: number;
  uploading?: boolean;
  error?: string;
};

type UploadIntent = {
  mediaId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_FILES = 20;
const MAX_BYTES = 15 * 1024 * 1024;

function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
}

function readDimensions(file: File) {
  return new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: null, height: null }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`));
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });
}

export function ListingPhotoUploader({ listingId }: { listingId?: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState<string>(listingId ? "" : "Créez d’abord le brouillon de l’annonce.");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readyItems = useMemo(() => items.filter((item) => item.status === "READY"), [items]);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`media_${response.status}`);
        return response.json() as Promise<{ media: MediaItem[] }>;
      })
      .then((payload) => { if (!cancelled) setItems(payload.media); })
      .catch(() => { if (!cancelled) setMessage("Impossible de charger les photos existantes pour le moment."); });
    return () => { cancelled = true; };
  }, [listingId]);

  async function uploadFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      setMessage("Formats acceptés : JPEG, PNG, WebP et AVIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage("Chaque photo doit faire moins de 15 Mo.");
      return;
    }
    if (items.length >= MAX_FILES) {
      setMessage("Maximum 20 photos par annonce.");
      return;
    }
    if (!listingId) {
      setMessage("Créez d’abord le brouillon de l’annonce avant d’ajouter des photos.");
      return;
    }

    const tempId = `local-${crypto.randomUUID()}`;
    const localPreview = URL.createObjectURL(file);
    const optimistic: MediaItem = {
      id: tempId, publicUrl: null, mimeType: file.type, sizeBytes: file.size, width: null, height: null,
      sortOrder: items.length * 10, isCover: items.length === 0, status: "PENDING", localPreview, progress: 0, uploading: true,
      altText: file.name,
    };
    setItems((current) => [...current, optimistic]);

    try {
      const intentResponse = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media/upload-intent`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size, altText: file.name }),
      });
      if (!intentResponse.ok) throw new Error(`intent_${intentResponse.status}`);
      const intent = await intentResponse.json() as UploadIntent;

      await putWithProgress(intent.uploadUrl, file, intent.headers, (progress) => {
        setItems((current) => current.map((item) => item.id === tempId ? { ...item, progress } : item));
      });

      const dimensions = await readDimensions(file);
      const confirmResponse = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media/${intent.mediaId}/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dimensions),
      });
      if (!confirmResponse.ok) throw new Error(`confirm_${confirmResponse.status}`);
      const confirmed = await confirmResponse.json() as { media: { id: string; url: string; width: number | null; height: number | null } };
      setItems((current) => current.map((item) => item.id === tempId ? {
        ...item,
        id: confirmed.media.id,
        publicUrl: confirmed.media.url,
        width: confirmed.media.width,
        height: confirmed.media.height,
        status: "READY",
        progress: 100,
        uploading: false,
      } : item));
      setMessage("Photo ajoutée.");
      URL.revokeObjectURL(localPreview);
    } catch {
      setItems((current) => current.map((item) => item.id === tempId ? { ...item, uploading: false, error: "Échec de l’envoi" } : item));
      setMessage("Une photo n’a pas pu être envoyée. Vérifiez la connexion au stockage puis réessayez.");
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, Math.max(0, MAX_FILES - items.length));
    for (const file of list) await uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function persistOrder(next: MediaItem[], coverId?: string) {
    setItems(next.map((item, index) => ({ ...item, sortOrder: index * 10, isCover: item.id === coverId })));
    if (!listingId) return;
    const ready = next.filter((item) => item.status === "READY");
    const firstReady = ready[0];
    if (!firstReady) return;
    const finalCover = coverId && ready.some((item) => item.id === coverId) ? coverId : ready.find((item) => item.isCover)?.id ?? firstReady.id;
    await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media/order`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaIds: ready.map((item) => item.id), coverMediaId: finalCover }),
    });
  }

  function onCardDrop(index: number) {
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex.current, 1);
    if (!moved) return;
    next.splice(index, 0, moved);
    dragIndex.current = null;
    void persistOrder(next, next.find((item) => item.isCover)?.id);
  }

  async function setCover(id: string) {
    await persistOrder(items, id);
    setMessage("Photo de couverture mise à jour.");
  }

  async function removeItem(item: MediaItem) {
    if (listingId && item.status === "READY") {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media/${item.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok && response.status !== 404) {
        setMessage("Impossible de supprimer cette photo.");
        return;
      }
    }
    if (item.localPreview) URL.revokeObjectURL(item.localPreview);
    const next = items.filter((candidate) => candidate.id !== item.id);
    const cover = next.find((candidate) => candidate.isCover)?.id ?? next[0]?.id;
    await persistOrder(next, cover);
    setMessage("Photo supprimée.");
  }

  return (
    <div className={styles.wrapper}>
      <div
        className={`${styles.dropzone} ${isDraggingFiles ? styles.dragActive : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingFiles(false); }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setIsDraggingFiles(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <div className={styles.camera}>📷</div>
        <div>
          <strong>Ajoutez jusqu’à 20 photos</strong>
          <p>Choisissez plusieurs images depuis votre galerie ou vos fichiers. Sur mobile, le sélecteur système vous laisse choisir galerie ou caméra.</p>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()}>Choisir des photos</button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
      </div>

      <div className={styles.infoRow}>
        <span>{items.length} / {MAX_FILES} photos</span>
        <span>JPEG · PNG · WebP · AVIF · 15 Mo max/photo</span>
      </div>

      {items.length > 0 && (
        <div className={styles.grid}>
          {items.map((item, index) => {
            const src = item.publicUrl ?? item.localPreview;
            return (
              <article
                key={item.id}
                draggable={!item.uploading}
                onDragStart={() => { dragIndex.current = index; }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onCardDrop(index)}
                className={`${styles.photoCard} ${item.isCover ? styles.cover : ""}`}
              >
                {src ? <img src={src} alt={item.altText ?? `Photo ${index + 1}`} /> : <div className={styles.placeholder}>Photo</div>}
                <div className={styles.badges}>
                  {item.isCover && <span>Couverture</span>}
                  {item.uploading && <span>{item.progress ?? 0}%</span>}
                  {item.error && <span className={styles.errorBadge}>Erreur</span>}
                </div>
                {item.uploading && <div className={styles.progress}><i style={{ width: `${item.progress ?? 0}%` }} /></div>}
                <div className={styles.photoActions}>
                  <button type="button" disabled={item.uploading || item.status !== "READY"} onClick={() => void setCover(item.id)}>Définir couverture</button>
                  <button type="button" disabled={item.uploading} onClick={() => void removeItem(item)}>Supprimer</button>
                </div>
                <div className={styles.dragHint}>☰ Glisser pour réordonner</div>
              </article>
            );
          })}
        </div>
      )}

      <div className={styles.footerNote}>
        <span>{message}</span>
        {readyItems.length > 0 && <b>{readyItems.length} photo{readyItems.length > 1 ? "s" : ""} prête{readyItems.length > 1 ? "s" : ""}</b>}
      </div>
    </div>
  );
}
