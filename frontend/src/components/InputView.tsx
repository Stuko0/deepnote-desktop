/**
 * Input widgets for the 8 input-* block types. The current value lives in the
 * block metadata (deepnote_variable_value), edited optimistically and sent to
 * the sidecar through the regular block:update path.
 */

import {
  Box,
  Checkbox,
  Code,
  FormControl,
  FormLabel,
  HStack,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  Select,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  Switch,
  Textarea,
} from '@chakra-ui/react';
import { useState } from 'react';

import type { BlockModel } from '../protocol';
import { inputBlockValue } from '../store';

export function InputView({
  block,
  onChange,
}: {
  block: BlockModel;
  onChange: (blockId: string, metadata: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState(() => inputBlockValue(block));

  const commit = (next: unknown): void => {
    setValue(next);
    onChange(block.id, { ...block.metadata, deepnote_variable_value: next });
  };

  const label = block.variableName ?? block.content ?? 'input';

  const wrapper = (children: React.ReactNode): JSX.Element => (
    <FormControl py={1}>
      <FormLabel mb={1} fontSize="xs" color="gray.600" textTransform="none">
        {label}
      </FormLabel>
      {children}
    </FormControl>
  );

  const options = block.content
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  switch (block.type) {
    case 'input-text':
      return wrapper(
        <Input size="sm" value={String(value ?? '')} onChange={(e) => commit(e.target.value)} />,
      );
    case 'input-textarea':
      return wrapper(
        <Textarea
          size="sm"
          value={String(value ?? '')}
          onChange={(e) => commit(e.target.value)}
          rows={3}
        />,
      );
    case 'input-checkbox':
      return (
        <HStack py={1}>
          <Switch isChecked={Boolean(value)} onChange={(e) => commit(e.target.checked)} />
          <Code fontSize="xs">{label}</Code>
        </HStack>
      );
    case 'input-select':
      return wrapper(
        <Select
          size="sm"
          value={String(value ?? options[0] ?? '')}
          onChange={(e) => commit(e.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>,
      );
    case 'input-slider':
      return wrapper(
        <HStack spacing={3}>
          <Slider min={0} max={100} value={Number(value ?? 0)} onChange={(v) => commit(v)} flex={1}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
          <NumberInput
            size="sm"
            maxW={20}
            value={Number(value ?? 0)}
            onChange={(_, n) => commit(Number.isFinite(n) ? n : 0)}
          >
            <NumberIncrementStepper />
            <NumberDecrementStepper />
          </NumberInput>
        </HStack>,
      );
    case 'input-date':
      return wrapper(
        <Input
          size="sm"
          type="date"
          value={String(value ?? '')}
          onChange={(e) => commit(e.target.value || null)}
        />,
      );
    case 'input-date-range':
      return wrapper(
        <HStack spacing={2}>
          <Input
            size="sm"
            type="date"
            value={String((value as { start?: string })?.start ?? '')}
            onChange={(e) => commit({ ...(value as object), start: e.target.value || null })}
          />
          <Box color="gray.400">to</Box>
          <Input
            size="sm"
            type="date"
            value={String((value as { end?: string })?.end ?? '')}
            onChange={(e) => commit({ ...(value as object), end: e.target.value || null })}
          />
        </HStack>,
      );
    case 'input-file':
      return wrapper(
        <Input size="sm" type="file" onChange={(e) => commit(e.target.files?.[0]?.name ?? null)} />,
      );
    default:
      return (
        <Stack spacing={2} py={1}>
          <Checkbox isChecked={Boolean(value)} onChange={(e) => commit(e.target.checked)}>
            {label}
          </Checkbox>
        </Stack>
      );
  }
}
