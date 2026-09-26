import type { Cliente } from '@/domain/types';
import { Avatar, type TamanoAvatar } from '@/ui/Avatar';
import { useFotoCliente } from './useFotoCliente';

/** Avatar de un cliente: su foto (resuelta según el modo) o sus iniciales. */
export function AvatarCliente({ cliente, tamano = 'md', className }: { cliente: Pick<Cliente, 'id' | 'nombre' | 'apellidos' | 'fotoUrl'> | null | undefined; tamano?: TamanoAvatar; className?: string }) {
  const url = useFotoCliente(cliente);
  return <Avatar nombre={cliente?.nombre ?? '?'} apellidos={cliente?.apellidos} fotoUrl={url} tamano={tamano} className={className} />;
}
