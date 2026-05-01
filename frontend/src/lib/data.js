export async function loadNetworkData() {
  const response = await fetch('/data/network.json')

  if (!response.ok) {
    throw new Error(`Failed to load network data: ${response.status}`)
  }

  return response.json()
}
