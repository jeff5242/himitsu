import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { MAX_SIGNATURE_LENGTH } from '../../lib/vip';

interface SignaturePadProps {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 300;
/** 上傳前縮小：簽名是線條，480×200 PNG 通常 5～20KB */
const EXPORT_WIDTH = 480;
const EXPORT_HEIGHT = 200;
const STROKE_WIDTH = 5;

function exportSignature(source: HTMLCanvasElement): string {
  const target = document.createElement('canvas');
  target.width = EXPORT_WIDTH;
  target.height = EXPORT_HEIGHT;
  const ctx = target.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  ctx.drawImage(source, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  const png = target.toDataURL('image/png');
  return png.length <= MAX_SIGNATURE_LENGTH ? png : target.toDataURL('image/jpeg', 0.7);
}

/** 手寫簽名板：pointer 事件同時支援觸控筆／手指／滑鼠；座標依顯示尺寸換算回畫布尺寸 */
export default function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const clear = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    setHasInk(false);
  };

  useEffect(clear, []);

  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointRef.current = toCanvasPoint(event);
  };

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const last = lastPointRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!last || !ctx) return;
    event.preventDefault();
    const point = toCanvasPoint(event);
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    setHasInk(true);
  };

  const handleUp = () => { lastPointRef.current = null; };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog"
      aria-modal="true" aria-label="簽名">
      <div className="w-full max-w-3xl rounded-2xl bg-stone-50 p-5 space-y-4">
        <p className="text-center text-xl font-bold text-stone-800">請於下方簽名</p>
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT}
          onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp}
          onPointerCancel={handleUp} onPointerLeave={handleUp}
          className="block w-full rounded-xl border-2 border-dashed border-stone-300 bg-white"
          style={{ touchAction: 'none', aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }} />
        <div className="flex flex-wrap gap-3 justify-end text-lg">
          <button type="button" onClick={clear} className="rounded-xl border border-stone-300 px-5 py-3">清除重簽</button>
          <button type="button" onClick={onCancel} className="rounded-xl border border-stone-300 px-5 py-3">取消</button>
          <button type="button" disabled={!hasInk}
            onClick={() => canvasRef.current && onConfirm(exportSignature(canvasRef.current))}
            className="rounded-xl bg-green-700 px-6 py-3 font-bold text-white disabled:opacity-40">✓ 確定</button>
        </div>
      </div>
    </div>
  );
}
