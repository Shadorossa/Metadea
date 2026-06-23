export async function validateExternalId(
  externalId: string,
  type: string
): Promise<boolean> {
  const [source, id] = externalId.split(":");

  if (!source || !id || isNaN(parseInt(id))) {
    return false;
  }

  try {
    switch (source) {
      case "game":
        return await validateIGDB(parseInt(id));
      case "anime":
      case "manga":
        return await validateAniList(parseInt(id), source);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function validateIGDB(gameId: number): Promise<boolean> {
  if (gameId <= 0) return false;
  // TODO: Implementar validación real contra IGDB API
  // Requiere IGDB_CLIENT_ID y IGDB_CLIENT_SECRET en env
  return true;
}

async function validateAniList(
  mediaId: number,
  type: "anime" | "manga"
): Promise<boolean> {
  if (mediaId <= 0) return false;
  // TODO: Implementar validación real contra AniList GraphQL
  return true;
}
