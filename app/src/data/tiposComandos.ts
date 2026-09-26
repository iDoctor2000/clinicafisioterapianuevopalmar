/** Tipos derivados de los comandos: nombre, argumentos y valor devuelto. */
import type * as comandos from './comandos';
import type { Ctx, Resultado } from './comandos';

export type Comandos = typeof comandos;

export type NombreComando = {
  [K in keyof Comandos]: Comandos[K] extends (ctx: Ctx, args: infer _A) => Resultado<infer _R> ? K : never;
}[keyof Comandos];

export type ArgsComando<K extends NombreComando> = Parameters<Comandos[K]>[1];

export type ValorComando<K extends NombreComando> = ReturnType<Comandos[K]> extends Resultado<infer R> ? R : never;
