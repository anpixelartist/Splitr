export interface ShareTransaction {
  from: string;
  to: string;
  amount: number;
}

export async function shareSettlementImage(
  transactions: ShareTransaction[],
  groupName: string,
  getName: (uid: string) => string,
): Promise<void> {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = 420;
  const HEADER_H = 90;
  const ROW_H = 64;
  const FOOTER_H = 48;
  const GAP = 10;
  const H = HEADER_H + transactions.length * ROW_H + GAP + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // ── Background ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#f0f4ff';
  ctx.fillRect(0, 0, W, H);

  // ── Header (blue) ───────────────────────────────────────────────────────
  ctx.fillStyle = '#1d4ed8';
  drawRoundRect(ctx, 0, 0, W, HEADER_H, [0, 0, 0, 0]);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 20px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  ctx.fillText('Settlement Summary', W / 2, 38);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `14px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  const displayName = groupName.length > 36 ? groupName.slice(0, 33) + '…' : groupName;
  ctx.fillText(displayName, W / 2, 64);

  // ── Transaction rows ────────────────────────────────────────────────────
  transactions.forEach((t, i) => {
    const rX = 12;
    const rY = HEADER_H + i * ROW_H + 8;
    const rW = W - 24;
    const rH = ROW_H - 10;

    // Card
    ctx.fillStyle = '#ffffff';
    drawRoundRect(ctx, rX, rY, rW, rH, 12);
    ctx.fill();

    const midY = rY + rH / 2;
    const fromName = getName(t.from);
    const toName = getName(t.to);

    // Avatar circle
    ctx.fillStyle = '#dbeafe';
    ctx.beginPath();
    ctx.arc(rX + 26, midY, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1d4ed8';
    ctx.font = `bold 13px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fromName.charAt(0).toUpperCase(), rX + 26, midY);

    // Name + subtext
    const textX = rX + 52;
    ctx.textAlign = 'left';

    ctx.fillStyle = '#111827';
    ctx.font = `bold 14px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const clampedFrom = fromName.length > 14 ? fromName.slice(0, 12) + '…' : fromName;
    ctx.fillText(clampedFrom, textX, midY - 4);

    ctx.fillStyle = '#6b7280';
    ctx.font = `12px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    const clampedTo = toName.length > 14 ? toName.slice(0, 12) + '…' : toName;
    ctx.fillText(`pays  ${clampedTo}`, textX, midY + 13);

    // Amount
    ctx.textAlign = 'right';
    ctx.fillStyle = '#16a34a';
    ctx.font = `bold 17px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`$${t.amount.toFixed(2)}`, rX + rW - 14, midY);
  });

  // ── Footer ──────────────────────────────────────────────────────────────
  const footerY = HEADER_H + transactions.length * ROW_H + GAP + 4;
  ctx.fillStyle = '#6b7280';
  ctx.font = `12px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const dateStr = new Date().toLocaleDateString(undefined, { dateStyle: 'medium' });
  ctx.fillText(`${dateStr} · Splitr`, W / 2, footerY + 20);

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Image generation failed')); return; }

      const file = new File([blob], 'settlement.png', { type: 'image/png' });
      const textSummary = transactions
        .map(t => `${getName(t.from)} pays ${getName(t.to)}: $${t.amount.toFixed(2)}`)
        .join('\n');

      try {
        if (navigator.share) {
          const shareData: ShareData = {
            title: `Settlement — ${groupName}`,
            text: textSummary,
          };
          // Add file if the browser supports it
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            (shareData as ShareData & { files: File[] }).files = [file];
          }
          await navigator.share(shareData);
        } else {
          downloadBlob(blob, `settlement-${slugify(groupName)}.png`);
        }
        resolve();
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') { resolve(); return; }
        downloadBlob(blob, `settlement-${slugify(groupName)}.png`);
        resolve();
      }
    }, 'image/png');
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | [number, number, number, number],
) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}
