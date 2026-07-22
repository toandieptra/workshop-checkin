"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";

interface GuestNote {
  id: string;
  guest_id: string;
  author_user_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export default function GuestNotes({ guestId }: { guestId: string }) {
  const { user, can } = useAuth();
  const [notes, setNotes] = useState<GuestNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const canWrite = can(PERMISSIONS.guestsEdit);
  const canEditAll = user?.role === "admin" || user?.role === "super_admin";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<GuestNote[]>(`/guests/${guestId}/notes`)
      .then((data) => {
        if (active) setNotes(data);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được ghi chú.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [guestId]);

  const createNote = async (event: FormEvent) => {
    event.preventDefault();
    const nextContent = content.trim();
    if (!nextContent || creating) return;
    setCreating(true);
    setError("");
    try {
      const note = await api<GuestNote>(`/guests/${guestId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: nextContent }),
      });
      setNotes((current) => [note, ...current]);
      setContent("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể thêm ghi chú.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (note: GuestNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setError("");
  };

  const saveEdit = async (noteId: string) => {
    const nextContent = editContent.trim();
    if (!nextContent || savingId) return;
    setSavingId(noteId);
    setError("");
    try {
      const updated = await api<GuestNote>(`/guests/${guestId}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ content: nextContent }),
      });
      setNotes((current) => current.map((note) => note.id === noteId ? updated : note));
      setEditingId(null);
      setEditContent("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật ghi chú.");
    } finally {
      setSavingId(null);
    }
  };

  return <section className="rounded-md border border-line bg-white p-4">
    <h4 className="font-semibold text-ink">Ghi chú</h4>

    <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-md border border-line bg-surface-muted/40 p-3" aria-live="polite">
      {loading ? <div className="py-5 text-center text-sm text-muted">Đang tải ghi chú...</div> : notes.length === 0 ? <div className="py-5 text-center text-sm text-muted">Không có ghi chú.</div> : notes.map((note) => {
        const canEdit = canWrite && (canEditAll || note.author_user_id === user?.id);
        const editing = editingId === note.id;
        return <article key={note.id} className="rounded-md border border-line bg-white px-3 py-2.5">
          {editing ? <div>
            <textarea
              autoFocus
              rows={3}
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              className="w-full resize-y rounded-md border border-brand px-3 py-2 text-sm leading-6 text-ink outline-none focus:ring-2 focus:ring-brand/20"
              aria-label="Chỉnh sửa nội dung ghi chú"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" disabled={savingId === note.id} onClick={() => { setEditingId(null); setEditContent(""); }} className="min-h-9 rounded-md border border-line px-3 text-xs font-semibold text-muted disabled:opacity-50">Hủy</button>
              <button type="button" disabled={!editContent.trim() || savingId === note.id} onClick={() => void saveEdit(note.id)} className="min-h-9 rounded-md bg-brand px-3 text-xs font-semibold text-brand-teal disabled:opacity-50">{savingId === note.id ? "Đang lưu..." : "Lưu"}</button>
            </div>
          </div> : <>
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{note.content}</div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-muted">
              <span><strong className="font-semibold text-text-secondary">{note.author_name}</strong> · {formatDateTime(note.created_at)}</span>
              {canEdit && <button type="button" onClick={() => startEdit(note)} className="min-h-8 px-2 font-semibold text-brand hover:underline">Sửa</button>}
            </div>
          </>}
        </article>;
      })}
    </div>

    {error && <div role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

    {canWrite && <form onSubmit={createNote} className="mt-3 flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Thêm ghi chú</span>
        <textarea
          rows={2}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Nhập ghi chú mới..."
          className="w-full resize-y rounded-md border border-line px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>
      <button type="submit" disabled={!content.trim() || creating} className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-brand-teal disabled:opacity-50">{creating ? "Đang gửi..." : "Thêm"}</button>
    </form>}
  </section>;
}
