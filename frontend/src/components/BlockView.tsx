import {
  Badge,
  Box,
  Code,
  HStack,
  Icon,
  Image,
  Spacer,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';

import type { BlockModel, IOutput } from '../protocol';

function StreamOutput({ output }: { output: IOutput }) {
  const isErr = output.name === 'stderr';
  return (
    <Code
      display="block"
      whiteSpace="pre-wrap"
      p={3}
      borderRadius="md"
      fontSize="sm"
      fontFamily="mono"
      bg={isErr ? 'red.50' : 'gray.50'}
      color={isErr ? 'red.700' : 'gray.800'}
      borderLeftWidth={4}
      borderLeftColor={isErr ? 'red.400' : 'gray.300'}
    >
      {output.text ?? ''}
    </Code>
  );
}

function ResultOutput({ output }: { output: IOutput }) {
  const text = (output.data?.['text/plain'] as string) ?? '';
  return (
    <Code
      display="block"
      whiteSpace="pre-wrap"
      p={3}
      borderRadius="md"
      fontSize="sm"
      bg="blue.50"
      color="blue.900"
    >
      {text}
    </Code>
  );
}

function ErrorOutput({ output }: { output: IOutput }) {
  return (
    <Box bg="red.50" borderLeftWidth={4} borderLeftColor="red.400" p={3} borderRadius="md">
      <Text fontWeight="semibold" color="red.700" fontSize="sm">
        {output.ename}: {output.evalue}
      </Text>
      {output.traceback && output.traceback.length > 0 && (
        <Code
          display="block"
          whiteSpace="pre-wrap"
          mt={2}
          fontSize="xs"
          bg="transparent"
          color="red.700"
        >
          {output.traceback.slice(-6).join('\n')}
        </Code>
      )}
    </Box>
  );
}

function DisplayOutput({ output }: { output: IOutput }) {
  const png = output.data?.['image/png'] as string | undefined;
  const html = output.data?.['text/html'] as string | undefined;
  if (png) {
    return (
      <Image src={`data:image/png;base64,${png}`} alt="output" maxH="420px" borderRadius="md" />
    );
  }
  if (html) {
    // Sandboxed iframe with null origin: untrusted notebook HTML cannot reach the app.
    const srcDoc = `<!doctype html><html><body style="font-family:Inter,sans-serif">${html}</body></html>`;
    return (
      <Box borderWidth="1px" borderRadius="md" overflow="hidden">
        <iframe
          title="html-output"
          sandbox=""
          srcDoc={srcDoc}
          style={{ width: '100%', height: 320, border: 'none' }}
        />
      </Box>
    );
  }
  return <ResultOutput output={output} />;
}

export function OutputsView({ outputs }: { outputs: IOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <VStack align="stretch" spacing={2} mt={2}>
      {outputs.map((output, index) => {
        const key = `${output.output_type}-${index}`;
        if (output.output_type === 'stream') return <StreamOutput key={key} output={output} />;
        if (output.output_type === 'execute_result')
          return <ResultOutput key={key} output={output} />;
        if (output.output_type === 'error') return <ErrorOutput key={key} output={output} />;
        return <DisplayOutput key={key} output={output} />;
      })}
    </VStack>
  );
}

const TYPE_COLORS: Record<string, string> = {
  code: 'blue',
  sql: 'green',
  markdown: 'gray',
  agent: 'purple',
};

export function BlockView({
  block,
  state,
}: {
  block: BlockModel;
  state?: { running: boolean; outputs: IOutput[]; durationMs?: number; success?: boolean };
}) {
  const isMarkdown = block.type === 'markdown' || block.type.startsWith('text-cell');
  const running = state?.running ?? false;

  return (
    <Box
      borderWidth="1px"
      borderColor={running ? 'accent.200' : 'gray.200'}
      borderRadius="lg"
      p={4}
      bg="white"
      _hover={{ borderColor: 'gray.300' }}
      transition="border-color 0.15s"
    >
      <HStack spacing={2} mb={isMarkdown ? 1 : 3}>
        <Badge
          colorScheme={TYPE_COLORS[block.type] ?? 'gray'}
          fontSize="0.65rem"
          textTransform="none"
        >
          {block.type}
        </Badge>
        {block.variableName && (
          <Tooltip label="Variable holding this block's result">
            <Code fontSize="0.65rem" px={1} bg="gray.100">
              {block.variableName}
            </Code>
          </Tooltip>
        )}
        <Spacer />
        {state?.durationMs !== undefined && (
          <Text fontSize="xs" color="gray.500">
            {state.durationMs} ms
          </Text>
        )}
        {running && (
          <HStack spacing={1}>
            <Icon viewBox="0 0 24 24" boxSize={3} color="accent.500">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                fill="none"
                opacity="0.25"
              />
              <path
                d="M22 12a10 10 0 0 0-10-10"
                stroke="currentColor"
                strokeWidth="3"
                fill="none"
              />
            </Icon>
            <Text fontSize="xs" color="accent.600">
              running
            </Text>
          </HStack>
        )}
      </HStack>

      {isMarkdown ? (
        <Text whiteSpace="pre-wrap" fontSize="md" color="gray.700">
          {block.content}
        </Text>
      ) : (
        <Code
          display="block"
          whiteSpace="pre-wrap"
          p={3}
          borderRadius="md"
          fontSize="sm"
          bg="gray.50"
          color="gray.800"
        >
          {block.content}
        </Code>
      )}

      <OutputsView outputs={state?.outputs ?? block.outputs} />
    </Box>
  );
}
