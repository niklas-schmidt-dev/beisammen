export function buildShareDetailHref(input: {
  shareBatchId: string;
  assetId?: string | null;
  /** Opens the detail screen with the caption editor already expanded. */
  edit?: boolean;
}): string {
  const encodedShareId = encodeURIComponent(input.shareBatchId);
  const params: string[] = [];

  if (input.assetId) {
    params.push(`assetId=${encodeURIComponent(input.assetId)}`);
  }

  if (input.edit) {
    params.push('edit=1');
  }

  return params.length > 0
    ? `/share/${encodedShareId}?${params.join('&')}`
    : `/share/${encodedShareId}`;
}
