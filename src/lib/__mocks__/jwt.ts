export const pack = async (_package): Promise<string> => "this-is-real-token";

export const unpack = async (
  token
): Promise<{ [index: string]: string | number }> => {
  if (token === "bad-token") throw new Error("Bad token man!");

  return { email: "this-email@email.com", id: "cust_1234" };
};
