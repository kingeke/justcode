/**
 * MIME types of the images the app carries to models as base64 blocks. Kept as
 * an enum so producers (clipboard paste, extracted video frames) and consumers
 * (the provider wires) can't drift on the raw string.
 */
export enum ImageMediaType {
  Png = 'image/png',
  Jpeg = 'image/jpeg',
  Webp = 'image/webp',
  Gif = 'image/gif',
}
