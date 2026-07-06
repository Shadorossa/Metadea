import { tauriRun } from './core';

/**
 * Actualiza la presencia de Discord con el título y el estado de la obra actual.
 * Si Discord no está abierto o el usuario no está en Tauri, se ignora silenciosamente.
 * @param details  - Línea principal: título de la obra
 * @param state    - Línea secundaria: "Viendo" / "Leyendo" / "Jugando" (desde i18n)
 * @param largeImageUrl  - URL HTTPS de la portada (cover de AniList/IGDB, etc.)
 * @param largeImageText - Tooltip al pasar el ratón sobre la imagen
 */
export async function updateDiscordPresence(
  details: string,
  state: string,
  largeImageUrl?: string,
  largeImageText?: string,
): Promise<void> {
  // Tauri v2 no convierte camelCase → snake_case; las claves deben coincidir exactamente con el Rust.
  return tauriRun('update_presence', {
    details,
    state,
    large_image_url: largeImageUrl,
    large_image_text: largeImageText,
  });
}

/**
 * Restablece la presencia de Discord al estado por defecto "Navegando por la biblioteca".
 * Llamar cuando el usuario sale de la media page.
 */
export async function resetDiscordPresence(): Promise<void> {
  return tauriRun('reset_presence');
}
