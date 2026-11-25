import { z } from 'zod';
export async function verifyUser(
  authorization: string | undefined,
  envId: string,
  request: typeof fetch = fetch,
) {
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization) || authorization.length > 16000)
    throw new Error('UNAUTHORIZED');
  if (!/^[a-zA-Z0-9-]+$/.test(envId)) throw new Error('SERVER_CONFIGURATION');
  const response = await request(`https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('UNAUTHORIZED');
  const user = z
    .object({ sub: z.string().min(1).max(200), status: z.literal('ACTIVE') })
    .safeParse(await response.json());
  if (!user.success) throw new Error('UNAUTHORIZED');
  return user.data.sub;
}
