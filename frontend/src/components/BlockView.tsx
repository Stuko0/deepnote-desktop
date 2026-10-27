import { ChevronDownIcon, ChevronUpIcon, DeleteIcon, TriangleUpIcon } from '@chakra-ui/icons';
import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Image,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from '@chakra-ui/react';
import Editor from '@monaco-editor/react';
import { useMemo, useState } from 'react';

import type { BlockModel, IOutput, NewBlockKind } from '../protocol';
import { InputView } from './InputView';

export interface BlockHandlers {
  onEdit: (blockId: string, content: string) => void;
  onUpdateMetadata: (blockId: string, metadata: Record<string, unknown>) => void;
  onRun: (blockId: string) => void;
  onMove: (blockId: string, direction: 'up' | 'down') => void;
  onDelete: (blockId: string) => void;
  onSelect: (blockId: string) => void;
  onCreateAfter: (blockId: string, blockType: NewBlockKind) => void;
}

const TYPE_COLORS: Record<string, string> = {
  code: 'blue',
  sql: 'green',
  markdown: 'gray',
  agent: 'purple',
  'input-text': 'orange',
  'input-textarea': 'orange',
  'input-checkbox': 'orange',
  'input-select': 'orange',
  'input-slider': 'orange',
  'input-date': 'orange',
  'input-date-range': 'orange',
  'input-file': 'orange',
};

function languageFor(type: string): string {
  if (type === 'sql') return 'sql';
  return 'python';
}

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
      borderLeftWidth="1px"
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

interface DataframeV3 {
  data?: Array<Record<string, unknown>>;
  columns?: Array<{ id: string; displayName?: string; dtype?: string }>;
  totalRows?: number;
}

function DataframeTable({ payload }: { payload: unknown }) {
  const [page, setPage] = useState(0);
  const df = payload as DataframeV3;
  const rows = df.data ?? [];
  const columns =
    df.columns?.map((c) => ({ id: c.id, label: c.displayName ?? c.id, dtype: c.dtype })) ??
    (rows[0] ? Object.keys(rows[0]).map((id) => ({ id, label: id, dtype: undefined })) : []);
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <Box borderWidth="1px" borderRadius="md" overflow="hidden" fontSize="sm">
      <Table size="sm" variant="simple">
        <Thead bg="gray.50">
          <Tr>
            {columns.map((col) => (
              <Th key={col.id} py={1}>
                {col.label}
                {col.dtype ? (
                  <Text as="span" color="gray.400" ml={1} fontSize="2xs">
                    {col.dtype}
                  </Text>
                ) : null}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {slice.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: paginated rows are re-indexed per page and have no stable id
            <Tr key={rowIndex}>
              {columns.map((col) => (
                <Td key={col.id} py={1} maxW={240} isTruncated>
                  {row[col.id] === null || row[col.id] === undefined ? (
                    <Text color="gray.400">null</Text>
                  ) : (
                    String(row[col.id])
                  )}
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>
      <HStack
        justify="space-between"
        px={3}
        py={1}
        bg="gray.50"
        borderTopWidth="1px"
        borderTopColor="gray.200"
      >
        <Text fontSize="xs" color="gray.500">
          {df.totalRows ?? rows.length} rows, {columns.length} cols
        </Text>
        <HStack spacing={1}>
          <Button size="xs" isDisabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Text fontSize="xs" color="gray.500">
            {page + 1} / {pages}
          </Text>
          <Button size="xs" isDisabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}

function DisplayOutput({ output }: { output: IOutput }) {
  const png = output.data?.['image/png'] as string | undefined;
  const html = output.data?.['text/html'] as string | undefined;
  const dataframe = output.data?.['application/vnd.deepnote.dataframe.v3+json'] as
    | unknown
    | undefined;
  if (dataframe) return <DataframeTable payload={dataframe} />;
  if (png)
    return (
      <Image src={`data:image/png;base64,${png}`} alt="output" maxH="420px" borderRadius="md" />
    );
  if (html) {
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

function ErrorOutput({ output }: { output: IOutput }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <Box bg="red.50" borderLeftWidth="1px" borderLeftColor="red.400" p={3} borderRadius="md">
      <Text fontWeight="semibold" color="red.700" fontSize="sm">
        {output.ename}: {output.evalue}
      </Text>
      <Button
        size="xs"
        mt={2}
        variant="outline"
        colorScheme="red"
        onClick={() => setShowDetails((s) => !s)}
      >
        {showDetails ? 'Hide error details' : 'Show error details'}
      </Button>
      {showDetails && output.traceback && (
        <Code
          display="block"
          whiteSpace="pre-wrap"
          mt={2}
          fontSize="xs"
          bg="transparent"
          color="red.700"
        >
          {output.traceback.join('\n')}
        </Code>
      )}
    </Box>
  );
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

export function BlockView({
  block,
  state,
  handlers,
  dagInfo,
}: {
  block: BlockModel;
  state?: { running: boolean; outputs: IOutput[]; durationMs?: number };
  handlers: BlockHandlers;
  dagInfo?: { upstream: string[]; downstream: string[] };
}) {
  const isMarkdown = block.type === 'markdown' || block.type.startsWith('text-cell');
  const isInput = block.type.startsWith('input-');
  const running = state?.running ?? false;
  const editorHeight = useMemo(
    () => Math.min(480, Math.max(48, (block.content.split('\n').length + 1) * 19)),
    [block.content],
  );

  return (
    <Box
      borderWidth="1px"
      borderColor={running ? 'accent.200' : 'gray.200'}
      borderRadius="lg"
      p={4}
      bg="white"
      _hover={{ borderColor: 'gray.300' }}
      transition="border-color 0.15s"
      onClick={() => handlers.onSelect(block.id)}
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
        {dagInfo && dagInfo.upstream.length > 0 && (
          <Tooltip label={`Depends on ${dagInfo.upstream.length} block(s) upstream`}>
            <Badge fontSize="0.6rem" colorScheme="purple" variant="subtle">
              depends on {dagInfo.upstream.length}
            </Badge>
          </Tooltip>
        )}
        {dagInfo && dagInfo.downstream.length > 0 && (
          <Tooltip label={`${dagInfo.downstream.length} dependent block(s) run after this one`}>
            <Badge fontSize="0.6rem" colorScheme="teal" variant="subtle">
              feeds {dagInfo.downstream.length}
            </Badge>
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
            <Text fontSize="xs" color="accent.600">
              running
            </Text>
          </HStack>
        )}
        <HStack spacing={1}>
          {block.isExecutable && (
            <Tooltip label="Run this block">
              <IconButton
                aria-label="Run block"
                icon={<TriangleUpIcon />}
                size="xs"
                variant="ghost"
                colorScheme="accent"
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onRun(block.id);
                }}
              />
            </Tooltip>
          )}
          <Tooltip label="Move up">
            <IconButton
              aria-label="Move up"
              icon={<ChevronUpIcon />}
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onMove(block.id, 'up');
              }}
            />
          </Tooltip>
          <Tooltip label="Move down">
            <IconButton
              aria-label="Move down"
              icon={<ChevronDownIcon />}
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onMove(block.id, 'down');
              }}
            />
          </Tooltip>
          <Menu>
            <MenuButton
              as={IconButton}
              aria-label="Block menu"
              icon={<DeleteIcon />}
              size="xs"
              variant="ghost"
            />
            <MenuList onClick={(e) => e.stopPropagation()} fontSize="sm">
              <MenuItem onClick={() => handlers.onCreateAfter(block.id, 'code')}>
                Add code block below
              </MenuItem>
              <MenuItem onClick={() => handlers.onCreateAfter(block.id, 'sql')}>
                Add SQL block below
              </MenuItem>
              <MenuItem onClick={() => handlers.onCreateAfter(block.id, 'markdown')}>
                Add text block below
              </MenuItem>
              <MenuItem color="red.500" onClick={() => handlers.onDelete(block.id)}>
                Delete block
              </MenuItem>
            </MenuList>
          </Menu>
        </HStack>
      </HStack>

      {isMarkdown ? (
        <Box
          as="textarea"
          value={block.content}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            handlers.onEdit(block.id, e.target.value)
          }
          w="100%"
          minH={60}
          p={2}
          borderRadius="md"
          borderWidth="1px"
          borderColor="transparent"
          _hover={{ borderColor: 'gray.200' }}
          _focus={{ borderColor: 'accent.200', outline: 'none' }}
          fontSize="md"
          color="gray.700"
          resize="vertical"
        />
      ) : isInput ? (
        <InputView
          block={block}
          onChange={(blockId, metadata) => handlers.onUpdateMetadata(blockId, metadata)}
        />
      ) : (
        <Box borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="gray.200">
          <Editor
            height={editorHeight}
            language={languageFor(block.type)}
            value={block.content}
            onChange={(value) => handlers.onEdit(block.id, value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              folding: false,
              glyphMargin: false,
              wordWrap: 'on',
              renderLineHighlight: 'none',
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              padding: { top: 8, bottom: 8 },
              overviewRulerLanes: 0,
              fixedOverflowWidgets: true,
            }}
            beforeMount={() => {
              // monaco is self-hosted via src/monaco.ts (loader.config)
            }}
          />
        </Box>
      )}

      <OutputsView outputs={state?.outputs ?? block.outputs} />
    </Box>
  );
}
