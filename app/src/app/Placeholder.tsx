import { Construction } from 'lucide-react';
import { Vacio } from '@/ui';

export function Placeholder({ titulo }: { titulo: string }) {
  return (
    <div className="py-6">
      <h1 className="text-3xl mb-4">{titulo}</h1>
      <Vacio icono={Construction} titulo="En construcción" texto="Esta pantalla estará disponible en la siguiente iteración." />
    </div>
  );
}
