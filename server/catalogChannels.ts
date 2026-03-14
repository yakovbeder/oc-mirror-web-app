export interface ChannelObject {
  name: string;
}

export interface GeneratedOperatorMetadata {
  channels?: Array<string | { name: string }>;
}

export function getChannelObjectsFromGeneratedOperator(
  operator: GeneratedOperatorMetadata | undefined,
): ChannelObject[] | null {
  if (!operator) {
    return null;
  }

  const normalizedChannels = (operator.channels ?? [])
    .map((channel) => (typeof channel === 'string' ? channel : channel?.name))
    .filter((channelName): channelName is string => Boolean(channelName));

  return normalizedChannels.map((name) => ({ name }));
}
