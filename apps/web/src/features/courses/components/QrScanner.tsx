import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X } from 'lucide-react';

type Props = {
  onScan: (studentId: string) => void;
  onClose: () => void;
};

export function QrScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastScannedRef = useRef<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play();
          rafRef.current = requestAnimationFrame(tick);
        }
      })
      .catch(() =>
        setError('No se pudo acceder a la cámara. Verifica los permisos del navegador.'),
      );

    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code?.data.startsWith('cssp:student:')) {
      const id = code.data.replace('cssp:student:', '');
      if (id !== lastScannedRef.current) {
        lastScannedRef.current = id;
        setLastScanned(id);
        onScan(id);
        setTimeout(() => {
          lastScannedRef.current = null;
          setLastScanned(null);
        }, 2000);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="font-semibold text-sm">Escanear QR del alumno</span>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition">
          <X className="h-5 w-5" />
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-white text-center text-sm">{error}</p>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />

          {/* Visor cuadrado */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-56 h-56 relative">
              <div className="absolute inset-0 border-2 border-primary rounded-2xl opacity-80" />
              {/* Esquinas */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-xl" />
            </div>
          </div>

          <p className="absolute top-4 left-0 right-0 text-center text-white/70 text-xs">
            Apunta al QR del alumno
          </p>

          {lastScanned && (
            <div className="absolute bottom-8 left-0 right-0 flex justify-center">
              <div className="bg-green-500 text-white px-6 py-3 rounded-full font-semibold text-sm shadow-lg">
                ✓ Alumno marcado presente
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
