// The runtime supplies only the implementations it can run. Keep the same records for a future backend.
export const chatModelConfiguration = {
  defaultId: 'local-demo',
  models: [{ id: 'local-demo', label: 'Demo cục bộ', provider: 'demo' }],
};

export function availableChatModels(providers, config = chatModelConfiguration) {
  return config.models.filter(({ provider }) => Object.hasOwn(providers, provider));
}

export function activeChatModel(models, savedId, config = chatModelConfiguration) {
  return models.find(({ id }) => id === savedId) ?? models.find(({ id }) => id === config.defaultId) ?? models[0];
}
