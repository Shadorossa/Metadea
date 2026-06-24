export async function validateExternalId(
  externalId: string,
  _type: string
): Promise<boolean> {
  const colonIndex = externalId.indexOf(':');
  if (colonIndex === -1) return false;

  const source = externalId.slice(0, colonIndex);
  const id     = externalId.slice(colonIndex + 1);

  if (!source || !id) return false;

  try {
    switch (source) {
      case 'game':
      case 'vnovel':
      case 'anime':
      case 'manga':
      case 'novel':
      case 'movie':
      case 'series':
        return isPositiveInteger(id);
      case 'book':
        return id.length > 0;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function isPositiveInteger(value: string): boolean {
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) && parsed > 0;
}
