export function ticketProductMatches(product, query) {
  if (product.is_active === false) return false;
  const text = [product.name, product.sku, product.barcode, product.part_number, product.manufacturer, product.category]
    .filter(Boolean).join(" ").toLocaleLowerCase();
  return String(query || "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
}
