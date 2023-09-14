import { RedisClientType } from "redis";

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireLock(
  client: RedisClientType,
  depositId: number,
  retries = 5
) {
  const tryAcquire = async (retriesLeft: number): Promise<any> => {
    const redisKey = `deposit:${depositId}:lock`;
    try {
      const res = await client.set(redisKey, "1", {
        NX: true,
        EX: 100,
      });

      if (res === null) {
        throw new Error("Unable to acquire redis lock.");
      }
    } catch (e) {
      if (retriesLeft <= 0) {
        throw e;
      }
      await delay(500);
      return tryAcquire(retriesLeft - 1);
    }
  };

  await tryAcquire(retries);
}

export async function releaseLock(client: RedisClientType, depositId: number) {
  await client.del(`deposit:${depositId}:lock`);
}
