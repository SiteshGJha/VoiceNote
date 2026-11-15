import { modelInstaller } from '@/services/modelManager/installer';

describe('modelInstaller provisioning checks', () => {
  it('checks provisioning status correctly', () => {
    const status = modelInstaller.getProvisioningStatus();
    expect(status).toHaveProperty('isProvisioned');
    expect(status).toHaveProperty('hasAsr');
    expect(status).toHaveProperty('hasSlm');
    expect(status).toHaveProperty('missingSpecs');
    expect(modelInstaller.isProvisioned()).toBe(status.isProvisioned);
  });

  it('selects recommended models for provisioning and never non-existent repos', () => {
    jest.spyOn(modelInstaller, 'listInstalled').mockReturnValue([]);
    const status = modelInstaller.getProvisioningStatus();
    expect(status.isProvisioned).toBe(false);

    const asrSpec = status.missingSpecs.find((s) => s.kind === 'asr');
    const slmSpec = status.missingSpecs.find((s) => s.kind === 'slm');

    expect(asrSpec?.id).toBe('whisper-base-multilingual');
    expect(slmSpec?.id).toBe('qwen2.5-0.5b-instruct');

    for (const spec of status.missingSpecs) {
      expect(spec.url).not.toContain('local-models');
      expect(spec.url).toMatch(/^https:\/\/huggingface\.co\//);
    }
  });
});
