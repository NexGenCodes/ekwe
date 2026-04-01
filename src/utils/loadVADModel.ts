import { Asset } from 'expo-asset';
import { InferenceSession } from 'onnxruntime-react-native';
import { EkweError } from 'src/constants/errors';
import type { Result } from 'src/types/Result';
import { ok, err } from 'src/types/Result';

let _session: InferenceSession | null = null;

export const loadVADModel = async (): Promise<
  Result<InferenceSession, EkweError>
> => {
  if (_session !== null) {
    return ok(_session);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const [asset] = await Asset.loadAsync(require('src/models/SileroVAD.onnx'));
    if (asset.localUri === null) {
      return err(EkweError.ONNX_LOAD_FAIL);
    }
    _session = await InferenceSession.create(asset.localUri);
    return ok(_session);
  } catch {
    return err(EkweError.ONNX_LOAD_FAIL);
  }
};

export const getVADSession = (): InferenceSession | null => _session;
