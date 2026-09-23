"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./listing-photo-uploader.module.css";
import { AppIcon } from "./app-icon";
import { sendSiteAnalyticsEvent } from "./site-telemetry";

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
  localFile?: File;
};

type UploadIntent = {
  mediaId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"];
const MAX_FILES = 20;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const OPTIMIZE_ABOVE_BYTES = 1400 * 1024;
const MAX_IMAGE_EDGE = 2560;

function normalizedMime(file: File) {
  if (ACCEPTED.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "";
}

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

async function prepareImageForUpload(file: File, mimeType: string): Promise<{ file: File; mimeType: string }> {
  if (file.size <= OPTIMIZE_ABOVE_BYTES && !["image/heic", "image/heif"].includes(mimeType)) return { file, mimeType };
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!loaded || !img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); return { file, mimeType }; }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { URL.revokeObjectURL(url); return { file, mimeType }; }
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) return { file, mimeType };
    if (scale === 1 && blob.size >= file.size) return { file, mimeType };
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { file: new File([blob], `${base}.webp`, { type: "image/webp", lastModified: file.lastModified }), mimeType: "image/webp" };
  } catch { return { file, mimeType }; }
}

function uploadDirectWithProgress(url: string, file: File, mimeType: string, onProgress: (value: number) => void) {
  return new Promise<{ media: { id: string; url: string; width: number | null; height: number | null } }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", mimeType);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`upload_${xhr.status}`));
      try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("upload_invalid_response")); }
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });
}

export function ListingPhotoUploader({ listingId, onStateChange, onLocalFilesChange }: { listingId?: string; onStateChange?: (state: { readyCount: number; uploading: boolean; coverUrl: string | null }) => void; onLocalFilesChange?: (files: Array<{ file: File; mimeType: string }>) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState<string>(listingId ? "" : "Le brouillon sera créé avant l’envoi définitif des photos.");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const readyItems = useMemo(() => items.filter((item) => item.status === "READY"), [items]);
  const uploading = useMemo(() => items.some((item) => Boolean(item.uploading)), [items]);
  const coverUrl = useMemo(() => { const cover = items.find((item) => item.isCover) ?? readyItems[0] ?? items[0]; return cover?.publicUrl ?? cover?.localPreview ?? null; }, [items, readyItems]);
  useEffect(() => { onStateChange?.({ readyCount: readyItems.length, uploading, coverUrl }); }, [readyItems.length, uploading, coverUrl, onStateChange]);
  useEffect(() => { if (!listingId) onLocalFilesChange?.(items.filter((item) => item.status === "LOCAL" && item.localFile).map((item) => ({ file: item.localFile!, mimeType: item.mimeType }))); }, [items, listingId, onLocalFilesChange]);

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

  async function uploadFile(file: File, sortIndex: number, makeCover: boolean): Promise<"ready"|"failed"|"invalid"> {
    const mimeType = normalizedMime(file);
    if (!mimeType) {
      setMessage("Format non pris en charge. Utilisez JPEG, PNG, WebP, AVIF, HEIC ou HEIF.");
      return "invalid";
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setMessage("Chaque photo source doit faire moins de 30 Mo.");
      return "invalid";
    }
    const prepared = await prepareImageForUpload(file, mimeType);
    const uploadFile = prepared.file;
    const uploadMimeType = prepared.mimeType;
    if (uploadFile.size > MAX_BYTES) {
      setMessage("Cette photo reste trop volumineuse après optimisation. Choisissez une image de moins de 15 Mo.");
      return "invalid";
    }
    if (sortIndex >= MAX_FILES) {
      setMessage("Maximum 20 photos par annonce.");
      return "invalid";
    }

    const tempId = `local-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const localPreview = URL.createObjectURL(uploadFile);
    const optimistic: MediaItem = {
      id: tempId, publicUrl: null, mimeType: uploadMimeType, sizeBytes: uploadFile.size, width: null, height: null,
      sortOrder: sortIndex * 10, isCover: makeCover, status: listingId ? "PENDING" : "LOCAL", localPreview, progress: 0, uploading: Boolean(listingId),
      altText: file.name, localFile: listingId ? undefined : uploadFile,
    };
    setItems((current) => [...current, optimistic]);

    if (!listingId) {
      setMessage("Photo prête. Elle sera envoyée dès que le brouillon de l’annonce sera créé.");
      return "ready";
    }

    try {
      const uploaded = await uploadDirectWithProgress(
        `${apiBase()}/listings/${encodeURIComponent(listingId)}/media/upload-direct`,
        uploadFile,
        uploadMimeType,
        (progress) => {
          setItems((current) => current.map((item) => item.id === tempId ? { ...item, progress } : item));
        },
      );
      const dimensions = await readDimensions(uploadFile);
      setItems((current) => current.map((item) => item.id === tempId ? {
        ...item,
        id: uploaded.media.id,
        publicUrl: uploaded.media.url,
        width: dimensions.width,
        height: dimensions.height,
        status: "READY",
        progress: 100,
        uploading: false,
      } : item));
      setMessage("Photo ajoutée.");
      URL.revokeObjectURL(localPreview);
    } catch {
      void sendSiteAnalyticsEvent("PHOTO_UPLOAD_FAILED",typeof window!=="undefined"?window.location.pathname:"/deposer-une-annonce");
      setItems((current) => current.map((item) => item.id === tempId ? { ...item, uploading: false, isCover: makeCover ? false : item.isCover, error: "Échec de l’envoi" } : item));
      setMessage("Une photo n’a pas pu être envoyée. Vous pouvez la supprimer puis réessayer.");
      return "failed";
    }
    return "ready";
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, Math.max(0, MAX_FILES - items.length));
    let sortIndex = items.length;
    let needsCover = !items.some((item) => item.isCover);
    for (const file of list) {
      const result = await uploadFile(file, sortIndex, needsCover);
      if (result !== "invalid") sortIndex += 1;
      if (result === "ready") needsCover = false;
    }
  }

  async function persistOrder(next: MediaItem[], coverId?: string): Promise<boolean> {
    setItems(next.map((item, index) => ({ ...item, sortOrder: index * 10, isCover: item.id === coverId })));
    if (!listingId) return true;
    const ready = next.filter((item) => item.status === "READY");
    const firstReady = ready[0];
    if (!firstReady) return true;
    const finalCover = coverId && ready.some((item) => item.id === coverId) ? coverId : ready.find((item) => item.isCover)?.id ?? firstReady.id;
    try {
      const response = await fetch(`${apiBase()}/listings/${encodeURIComponent(listingId)}/media/order`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaIds: ready.map((item) => item.id), coverMediaId: finalCover }),
      });
      if (!response.ok) throw new Error(`media_order_${response.status}`);
      return true;
    } catch {
      setMessage("Impossible d’enregistrer l’ordre des photos. Réessayez.");
      return false;
    }
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

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void persistOrder(next, next.find((item) => item.isCover)?.id);
  }

  async function setCover(id: string) {
    const ok = await persistOrder(items, id);
    if (ok) setMessage("Photo de couverture mise à jour.");
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
    const orderSaved = await persistOrder(next, cover);
    setMessage(orderSaved ? "Photo supprimée." : "Photo supprimée, mais l’ordre restant n’a pas pu être enregistré. Réessayez de réordonner les photos.");
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
        <div className={styles.camera}><AppIcon name="camera"/></div>
        <div>
          <strong>Ajoutez jusqu’à 20 photos</strong>
          <p>Glissez-déposez vos images ici ou choisissez-les depuis votre téléphone. La première photo devient la couverture.</p>
          <small className={styles.formatHint}>JPEG · PNG · WebP · AVIF · HEIC · HEIF · 15 Mo max/photo</small>
        </div>
        <div className={styles.sourceActions}>
          <button type="button" onClick={() => galleryInputRef.current?.click()}><AppIcon name="image"/>Choisir dans la galerie</button>
          <button type="button" className={styles.cameraButton} onClick={() => cameraInputRef.current?.click()}><AppIcon name="camera"/>Prendre une photo</button>
        </div>
        <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif" multiple hidden onChange={(event) => { if (event.target.files?.length) void handleFiles(event.target.files); event.currentTarget.value = ""; }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { if (event.target.files?.length) void handleFiles(event.target.files); event.currentTarget.value = ""; }} />
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
                <div className={styles.mobileOrderActions} aria-label={`Réordonner la photo ${index + 1}`}>
                  <button type="button" disabled={item.uploading || index === 0} onClick={() => moveItem(index, -1)} aria-label="Déplacer la photo avant">← Avant</button>
                  <span>{index + 1}/{items.length}</span>
                  <button type="button" disabled={item.uploading || index === items.length - 1} onClick={() => moveItem(index, 1)} aria-label="Déplacer la photo après">Après →</button>
                </div>
                <div className={styles.photoActions}>
                  <button type="button" disabled={item.uploading || (item.status !== "READY" && Boolean(listingId))} onClick={() => void setCover(item.id)}>Définir couverture</button>
                  <button type="button" disabled={item.uploading} onClick={() => void removeItem(item)}>Supprimer</button>
                </div>
                <div className={styles.dragHint}><AppIcon name="grip"/> Glisser pour réordonner</div>
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
