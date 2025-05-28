import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@codemirror/highlight";
import { keymap } from "@codemirror/view";

// Basic editor setup
const basicSetup = [
    EditorView.lineWrapping,
    EditorView.editable.of(true),
    keymap.of(defaultKeymap)
];

// Define AST node types
const ASTNodeType = {
  COMMAND: 'command',
  ENVIRONMENT: 'environment',
  MATH: 'math',
  TEXT: 'text',
  COMMENT: 'comment'
};

// AST node class
class ASTNode {
  constructor(type, value, children = []) {
    this.type = type;
    this.value = value;
    this.children = children;
    this.parent = null;
    for (const child of children) {
      child.parent = this;
    }
  }
}

// Define LaTeX language
const latexLanguage = StreamLanguage.define({
  name: "latex",
  startState() {
    return {
      inMath: false,
      mathDelimiter: null,
      environmentStack: []
    };
  },
  token(stream, state) {
    // Комментарии
    if (stream.match("%")) {
      stream.skipToEnd();
      return "comment";
    }

    // Математический режим (вход/выход)
    if (!state.inMath) {
      if (stream.match("$$")) {
        state.inMath = true;
        state.mathDelimiter = "$$";
        return "math-delimiter";
      }
      if (stream.match("$")) {
        state.inMath = true;
        state.mathDelimiter = "$";
        return "math-delimiter";
      }
      if (stream.match("\\[")) {
        state.inMath = true;
        state.mathDelimiter = "\\[";
        return "math-delimiter";
      }
    } else {
      // Внутри math mode
      if (state.mathDelimiter === "$$" && stream.match("$$")) {
        state.inMath = false;
        state.mathDelimiter = null;
        return "math-delimiter";
      }
      if (state.mathDelimiter === "$" && stream.match("$")) {
        state.inMath = false;
        state.mathDelimiter = null;
        return "math-delimiter";
      }
      if (state.mathDelimiter === "\\[" && stream.match("\\]")) {
        state.inMath = false;
        state.mathDelimiter = null;
        return "math-delimiter";
      }
      // Внутри математики: команды, операторы, числа
      if (stream.match(/\\[a-zA-Z@]+/)) return "math-command";
      if (stream.match(/[+\-*/=<>^_{}()]/)) return "operator";
      if (stream.match(/[0-9]+/)) return "number";
      stream.next();
      return "math";
    }

    // Окружения
    if (stream.match(/\\begin\{[a-zA-Z*]+\}/)) {
      const envName = stream.current().match(/\\begin\{([a-zA-Z*]+)\}/)[1];
      state.environmentStack.push(envName);
      return "environment-begin";
    }
    if (stream.match(/\\end\{[a-zA-Z*]+\}/)) {
      const envName = stream.current().match(/\\end\{([a-zA-Z*]+)\}/)[1];
      const lastEnv = state.environmentStack.pop();
      if (lastEnv !== envName) return "environment-error";
      return "environment-end";
    }

    // Команды
    if (stream.match(/\\[a-zA-Z@]+/)) {
      const cmd = stream.current();
      const type = getCommandType(cmd);
      return type;
    }

    // Операторы вне математики
    if (stream.match(/[&_^#]/)) return "operator";

    // Аргументы команд
    if (stream.match(/\{[^}]*\}/)) return "brace";

    if (stream.match(/[a-zA-Z*@]+(?=\})/)) {
      // Проверяем, что перед этим был \begin{ или \end{
      const prev = stream.string.slice(0, stream.pos - stream.current().length);
      if (/\\begin\{$/.test(prev) || /\\end\{$/.test(prev)) {
        return "variableName";
      }
    }

    // Пропуск остальных символов
    stream.next();
    return null;
  }
});


// Create highlighting style
const defaultlatexHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#00f" }, // Общие команды
  { tag: tags.comment, color: "#888" }, // Комментарии
  { tag: tags.number, color: "#f00" }, // Math mode
  { tag: tags.operator, color: "#b52a1d" }, // Операторы
  { tag: tags.string, color: "#008800" }, // Аргументы
  { tag: tags.strong, color: "#0055aa", fontWeight: "bold" }, // Структурные команды
  { tag: tags.emphasis, color: "#008800", fontStyle: "italic" }, // Форматирующие команды
  { tag: tags.monospace, color: "#990099" }, // math-command
  { tag: tags.invalid, color: "#fff", backgroundColor: "#f44" }, // Ошибки
  { tag: tags.atom, color: "#003366", fontWeight: "bold" }, // Начало/конец окружения
  { tag: tags.meta, color: "#990099", fontWeight: "bold" }, // math-delimiter
  { tag: tags.variableName, color: "#aa5500" } // Ссылки, цитаты
]);


// Function to check for math mode errors
function checkMathErrors(text) {
  const errors = [];

  // 1. Найти диапазоны math mode: $...$, $$...$$, \[...\], окружения
  const mathRanges = [];

  // $...$ и $$...$$
  const inlineMath = /\$(?!\$)([^\$]|\\\$)*?\$/g;
  const displayMath = /\$\$[\s\S]*?\$\$/g;
  const bracketMath = /\\\[[\s\S]*?\\\]/g;

  let match;
  while ((match = inlineMath.exec(text))) {
    mathRanges.push([match.index, inlineMath.lastIndex]);
  }
  while ((match = displayMath.exec(text))) {
    mathRanges.push([match.index, displayMath.lastIndex]);
  }
  while ((match = bracketMath.exec(text))) {
    mathRanges.push([match.index, bracketMath.lastIndex]);
  }

  // Math environments
  const envPattern = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|flalign\*?|alignat\*?|math|displaymath)\}([\s\S]*?)\\end\{\1\}/g;
  while ((match = envPattern.exec(text))) {
    mathRanges.push([match.index, envPattern.lastIndex]);
  }

  // Проверка: находится ли позиция внутри math mode
  function inMath(pos) {
    return mathRanges.some(([start, end]) => pos >= start && pos < end);
  }

  // Новый паттерн: ищем только выражения с ^ или _ между буквами/цифрами
  const mathPattern = /\b([a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9]+|[a-zA-Z][a-zA-Z0-9]*\^[a-zA-Z0-9]+)\b/g;
  while ((match = mathPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (!inMath(start)) {
      // Игнорировать, если это часть команды, ссылки, label, cite, href, или содержит только буквы и подчёркивания
      const before = text.slice(Math.max(0, start - 20), start);
      if (/(label|ref|cite|href|pageref|url|input|include)\s*\{?$/i.test(before)) continue;
      // Игнорировать, если это просто имя из букв и подчёркиваний (нет цифр, нет операций)
      if (/^[a-zA-Z_]+$/.test(match[0])) continue;
      // Игнорировать, если это имя в стиле page_size, International_language, document_class и т.п.
      if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(match[0])) continue;
      const line = text.substring(0, end).split('\n').length;
      errors.push({
        type: 'math-mode',
        line: line,
        message: 'Math expression should be enclosed in $...$',
        suggestion: `% CORRECT:\n$${match[0]}$`,
        range: [start, end]
      });
    }
  }

  return errors;
}

// Function to check for environment errors
function checkEnvironmentErrors(text) {
    const errors = [];
    
    // Check for mismatched begin/end environments
    const beginPattern = /\\begin\{([^}]+)\}/g;
    const endPattern = /\\end\{([^}]+)\}/g;
    
    const environments = [];
    const lines = text.split('\n');
    
    // Track all begin environments
    let match;
    let lineIndex = 0;
    let position = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        beginPattern.lastIndex = 0;
        
        while ((match = beginPattern.exec(line)) !== null) {
            environments.push({
                name: match[1],
                line: i + 1,
                position: match.index,
                type: 'begin'
            });
        }
        
        endPattern.lastIndex = 0;
        while ((match = endPattern.exec(line)) !== null) {
            // Check if this end matches the last begin
            const envName = match[1];
            
            // Find the matching begin environment
            let matchingBeginIndex = -1;
            for (let j = environments.length - 1; j >= 0; j--) {
                if (environments[j].type === 'begin' && environments[j].name === envName) {
                    matchingBeginIndex = j;
                    break;
                }
            }
            
            if (matchingBeginIndex === -1) {
                // No matching begin found
                errors.push({
                    type: 'environment',
                    line: i + 1,
                    message: `Unmatched \\end{${envName}} without a corresponding \\begin{${envName}}`,
                    explanation: 'Every \\end{} command must have a matching \\begin{} command with the same environment name.',
                    suggestion: `% CORRECT:\n\\begin{${envName}}\n  Content goes here\n\\end{${envName}}`
                });
            } else {
                // Remove matched pair
                environments.splice(matchingBeginIndex, 1);
            }
        }
    }
    
    // Check for any remaining unmatched begin environments
    for (const env of environments) {
        errors.push({
            type: 'environment',
            line: env.line,
            message: `Unmatched \\begin{${env.name}} without a corresponding \\end{${env.name}}`,
            explanation: 'Every \\begin{} command must have a matching \\end{} command with the same environment name.',
            suggestion: `% CORRECT:\n\\begin{${env.name}}\n  Content goes here\n\\end{${env.name}}`
        });
    }
    
    return errors;
}

// Function to check for command errors
function checkCommandErrors(text) {
    const errors = [];
    
    // Check for unclosed braces in commands
    const commandPattern = /\\[a-zA-Z@]+\{([^{}]*(\{[^{}]*\}[^{}]*)*)?([^{}]*\{)?/g;
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        
        commandPattern.lastIndex = 0;
        while ((match = commandPattern.exec(line)) !== null) {
            // If there's an unclosed brace
            if (match[3]) {
                errors.push({
                    type: 'command',
                    line: i + 1,
                    message: 'Unclosed brace in command argument',
                    explanation: 'Commands with braced arguments must have properly closed braces.',
                    suggestion: `% CORRECT:\n${match[0]}}  % Close the brace`
                });
            }
        }
        
        // Check for undefined commands (simplified approach)
        const unknownCommandPattern = /\\([a-zA-Z@]+)/g;
        unknownCommandPattern.lastIndex = 0;
        
        while ((match = unknownCommandPattern.exec(line)) !== null) {
            const command = match[1];
            
            // Check against a list of common LaTeX commands (simplified)
            if (!isKnownCommand(command)) {
                errors.push({
                    type: 'unknown-command',
                    line: i + 1,
                    message: `Potentially undefined command: \\${command}`,
                    explanation: 'This command may not be defined in standard LaTeX or may need a package.',
                    suggestion: `% SOLUTION 1: Check spelling\n% SOLUTION 2: Include required package\n\\usepackage{package-name}  % Replace with the appropriate package`
                });
            }
        }
    }
    
    return errors;
}

// Helper function to check if a command is known
function isKnownCommand(command) {
    // This is a simplified list - in a real implementation, this would be much more comprehensive
    const commonCommands = [
        'section', 'subsection', 'textbf', 'textit', 'underline', 'emph',
        'begin', 'end', 'item', 'label', 'ref', 'cite', 'usepackage',
        'documentclass', 'title', 'author', 'date', 'maketitle',
        'includegraphics', 'footnote', 'caption', 'frac', 'sum', 'int',
        'textwidth', 'linewidth', 'columnwidth', 'paperwidth', 'height', 'width',
    'textheight', 'columnheight', 'paperheight', 'baselineskip',
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega', 'leq', 'geq', 'neq',
'cdot', 'ldots', 'dots', 'to', 'left', 'right', 'sqrt', 'pm', 'times', 'div',
'le', 'ge', 'approx', 'equiv', 'partial', 'infty', 'forall', 'exists', 'nabla',
'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'centering', 'hline', 'href', 'LaTeX', 'cdots', 'mathcal', 'verb', 'bibliographystyle', 'bibliography','url', 'text',
'textcolor', 'addplot', 'in', 'mathbb'

    ];
    
    return commonCommands.includes(command);
}

// Function to determine command type for highlighting
function getCommandType(cmd) {
  const name = cmd.slice(1);
  if (['section', 'subsection', 'chapter', 'paragraph', 'subparagraph'].includes(name))
    return "structure-command";
  if (['textbf', 'textit', 'underline', 'emph', 'textsc', 'texttt'].includes(name))
    return "formatting-command";
  if (['frac', 'sum', 'int', 'prod', 'lim', 'infty', 'partial'].includes(name))
    return "math-command";
  if (['cite', 'ref','herf', 'pageref', 'footnote'].includes(name))
    return "reference-command";
  if (['begin', 'end'].includes(name))
    return "environment-command";
  return "keyword";
}


// Function to perform performance testing
function performanceTest(text, iterations = 10) {
    console.log(`Running performance test with ${iterations} iterations...`);
    
    const times = {
        totalTime: [],
        errorChecking: [],
        astBuilding: [],
        tokenization: [],
        rendering: []
    };
    
    for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        // Error checking
        const errorStart = performance.now();
        const errors1 = checkMathErrors(text);
        const errors2 = checkEnvironmentErrors(text);
        const errors3 = checkCommandErrors(text);
        const errorTime = performance.now() - errorStart;
        times.errorChecking.push(errorTime);
        
        // AST building
        const astStart = performance.now();
        const ast = buildAST(text);
        const astTime = performance.now() - astStart;
        times.astBuilding.push(astTime);
        
        // Tokenization (simplified for testing)
        const tokenStart = performance.now();
        const lines = text.split('\n');
        let processedLines = [];
        
        for (const line of lines) {
            let processed = '';
            let i = 0;
            while (i < line.length) {
                if (line[i] === '\\') {
                    // Process command
                    let j = i + 1;
                    while (j < line.length && /[a-zA-Z@]/.test(line[j])) j++;
                    processed += `<span class="command">${line.substring(i, j)}</span>`;
                    i = j;
                } else {
                    processed += line[i];
                    i++;
                }
            }
            processedLines.push(processed);
        }
        const tokenTime = performance.now() - tokenStart;
        times.tokenization.push(tokenTime);
        
        // Rendering (simulated)
        const renderStart = performance.now();
        const html = processedLines.join('<br>');
        const renderTime = performance.now() - renderStart;
        times.rendering.push(renderTime);
        
        // Total time
        const totalTime = performance.now() - startTime;
        times.totalTime.push(totalTime);
    }
    
    // Calculate averages
    const averages = {};
    for (const key in times) {
        averages[key] = times[key].reduce((a, b) => a + b, 0) / iterations;
    }
    
    console.log('Performance Test Results:');
    console.log(`Average Total Time: ${averages.totalTime.toFixed(2)} ms`);
    console.log(`Average Error Checking: ${averages.errorChecking.toFixed(2)} ms`);
    console.log(`Average AST Building: ${averages.astBuilding.toFixed(2)} ms`);
    console.log(`Average Tokenization: ${averages.tokenization.toFixed(2)} ms`);
    console.log(`Average Rendering: ${averages.rendering.toFixed(2)} ms`);
    
    return averages;
}

// Function to build AST from LaTeX text
function buildAST(text) {
  const root = new ASTNode(ASTNodeType.TEXT, '', []);
  let currentNode = root;
  let i = 0;
  while (i < text.length) {
    // Окружение \begin{...}
    if (text.startsWith('\\begin{', i)) {
      let j = i + 7;
      let envName = '';
      while (j < text.length && text[j] !== '}') {
        envName += text[j];
        j++;
      }
      if (text[j] === '}') {
        j++; // пропускаем '}'
        const envNode = new ASTNode(ASTNodeType.ENVIRONMENT, envName, []);
        envNode.parent = currentNode;
        currentNode.children.push(envNode);
        currentNode = envNode;
        i = j;
        continue;
      }
    }
    // Окружение \end{...}
    if (text.startsWith('\\end{', i)) {
      let j = i + 5;
      let envName = '';
      while (j < text.length && text[j] !== '}') {
        envName += text[j];
        j++;
      }
      if (text[j] === '}') {
        j++; // пропускаем '}'
        // Закрываем окружение только если совпадает имя
        if (currentNode.type === ASTNodeType.ENVIRONMENT && currentNode.value === envName) {
          currentNode = currentNode.parent || root;
        }
        i = j;
        continue;
      }
    }
    // Команда
    if (text[i] === '\\') {
      let command = '\\';
      i++;
      while (i < text.length && /[a-zA-Z@]/.test(text[i])) {
        command += text[i];
        i++;
      }
      const node = new ASTNode(ASTNodeType.COMMAND, command);
      node.parent = currentNode;
      currentNode.children.push(node);
      currentNode = node;
      continue;
    }
    // Аргумент команды
    if (text[i] === '{') {
      i++;
      continue;
    }
    // Конец аргумента
    if (text[i] === '}') {
      currentNode = currentNode.parent || root;
      i++;
      continue;
    }
    // Математический режим
    if (text[i] === '$') {
      const node = new ASTNode(ASTNodeType.MATH, '$');
      node.parent = currentNode;
      currentNode.children.push(node);
      currentNode = node;
      i++;
      continue;
    }
    // Комментарий
    if (text[i] === '%') {
      const comment = text.slice(i);
      const node = new ASTNode(ASTNodeType.COMMENT, comment);
      node.parent = currentNode;
      currentNode.children.push(node);
      break;
    }
    // Обычный текст
    const node = new ASTNode(ASTNodeType.TEXT, text[i]);
    node.parent = currentNode;
    currentNode.children.push(node);
    i++;
  }
  return root;
}

// Function to visualize AST
function visualizeAST(node, level = 0) {
  const indent = '  '.repeat(level);
  let result = `${indent}${node.type}: ${node.value}\n`;
  for (const child of node.children) {
    result += visualizeAST(child, level + 1);
  }
  return result;
}

// Function to traverse AST and process nodes
function traverseAST(node, callback) {
  callback(node);
  for (const child of node.children) {
    traverseAST(child, callback);
  }
}

// Function to process LaTeX and update preview
function processLatex(text) {
    const preview = document.getElementById('preview');
    let html = '';
    
    // Performance measurement - start time
    const startTime = performance.now();
    
    // Create chain of responsibility for error handling
    const errors = [];
    
    // First handler - check for math errors
    errors.push(...checkMathErrors(text));
    
    // Second handler - check for environment errors
    errors.push(...checkEnvironmentErrors(text));
    
    // Third handler - check for command errors 
    errors.push(...checkCommandErrors(text));
    
    // Build AST for syntax analysis
    const ast = buildAST(text);
    
    // Split text into lines for processing
    const lines = text.split('\n');
    
    // Performance metrics for different phases
    const timings = {
        errorChecking: 0,
        astBuilding: 0,
        tokenization: 0,
        rendering: 0
    };
    
    timings.errorChecking = performance.now() - startTime;
    const astBuildTime = performance.now();
    
    // Track statistics for analysis
    const stats = {
        totalLines: lines.length,
        totalCommands: 0,
        totalMathExpressions: 0,
        totalEnvironments: 0,
        totalComments: 0,
        nestedDepth: 0,
        maxNestedDepth: 0
    };
    
    // Collect statistics from AST
    traverseAST(ast, (node) => {
        switch(node.type) {
            case ASTNodeType.COMMAND:
                stats.totalCommands++;
                break;
            case ASTNodeType.MATH:
                stats.totalMathExpressions++;
                break;
            case ASTNodeType.ENVIRONMENT:
                stats.totalEnvironments++;
                break;
            case ASTNodeType.COMMENT:
                stats.totalComments++;
                break;
        }
        
        // Track nesting depth
        if (node.children && node.children.length > 0) {
            stats.nestedDepth++;
            stats.maxNestedDepth = Math.max(stats.maxNestedDepth, stats.nestedDepth);
        } else if (node.parent) {
            stats.nestedDepth--;
        }
    });
    
    timings.astBuilding = performance.now() - astBuildTime;
    const tokenizationTime = performance.now();
    
    lines.forEach((line, lineIndex) => {
        // Skip empty lines
        if (!line.trim()) {
            html += '<br>';
            return;
        }
        
        // Create a container for each line
        let processedLine = '<div class="processed-line">';
        
        // Check if this line has any errors
        const lineErrors = errors.filter(err => err.line === lineIndex + 1);
        
        if (lineErrors.length > 0) {
            // Add error highlighting with detailed information
            processedLine += `<div class="error-line">`;
            processedLine += `<div class="error-message">⚠️ ${lineErrors[0].message}</div>`;
            
            // Include all suggestions for this error
            if (lineErrors[0].suggestion) {
                processedLine += `<div class="error-suggestion">${lineErrors[0].suggestion}</div>`;
            }
            
            // Add explanation for the error if available
            if (lineErrors[0].explanation) {
                processedLine += `<div class="error-explanation">${lineErrors[0].explanation}</div>`;
            }
            
            processedLine += `</div>`;
        }
        
        // Process the line character by character using advanced context-aware rules
        let i = 0;
        let contextStack = []; // Track nested contexts
        
        while (i < line.length) {
            if (line[i] === '\\') {
                // Handle LaTeX commands with improved recognition
                let command = '\\';
                i++;
                while (i < line.length && /[a-zA-Z@]/.test(line[i])) {
                    command += line[i];
                    i++;
                }
                
                // Apply different styles based on command category
                const commandType = getCommandType(command);
                processedLine += `<span class="command ${commandType}">${command}</span>`;
                
                // Track context for improved highlighting
                contextStack.push('command');
                
                // Handle command arguments with better nesting support
                if (i < line.length && line[i] === '{') {
                    let arg = '{';
                    i++;
                    let braceCount = 1;
                    
                    // Track the beginning of the argument for error highlighting
                    const argStart = i;
                    
                    while (i < line.length && braceCount > 0) {
                        if (line[i] === '{') braceCount++;
                        if (line[i] === '}') braceCount--;
                        arg += line[i];
                        i++;
                    }
                    
                    // Check for unclosed braces
                    if (braceCount > 0) {
                        processedLine += `<span class="argument error-highlight" title="Unclosed brace">${arg}</span>`;
                    } else {
                        processedLine += `<span class="argument">${arg}</span>`;
                    }
                    
                    // End of argument context
                    if (contextStack.length > 0) contextStack.pop();
                }
                
            } else if (line[i] === '$') {
                // Handle math mode with improved error detection
                let math = '$';
                const mathStart = i;
                i++;
                
                // Enter math context
                contextStack.push('math');
                
                while (i < line.length && line[i] !== '$') {
                    math += line[i];
                    i++;
                }
                
                if (i < line.length) {
                    math += '$';
                    i++;
                    // Exit math context
                    if (contextStack.length > 0) contextStack.pop();
                    processedLine += `<span class="math">${math}</span>`;
                } else {
                    // Unclosed math expression
                    processedLine += `<span class="math error-highlight" title="Unclosed math expression">${math}</span>`;
                }
                
            } else if (line[i] === '%') {
                // Handle comments
                let comment = line.slice(i);
                processedLine += `<span class="comment">${comment}</span>`;
                break;
                
            } else if (line[i] === '{' || line[i] === '}') {
                // Highlight braces for better visualization
                processedLine += `<span class="brace">${line[i]}</span>`;
                i++;
                
            } else if (line.substring(i, i+6) === '\\begin' || line.substring(i, i+4) === '\\end') {
                // Special handling for environment commands
                let envCommand;
                if (line.substring(i, i+6) === '\\begin') {
                    envCommand = '\\begin';
                    i += 6;
                    contextStack.push('environment-begin');
                } else {
                    envCommand = '\\end';
                    i += 4;
                    contextStack.push('environment-end');
                }
                
                processedLine += `<span class="environment-command">${envCommand}</span>`;
                
                // Handle environment name
                if (i < line.length && line[i] === '{') {
                    let envName = '{';
                    i++;
                    while (i < line.length && line[i] !== '}') {
                        envName += line[i];
                        i++;
                    }
                    
                    if (i < line.length) {
                        envName += '}';
                        i++;
                        processedLine += `<span class="environment-name">${envName}</span>`;
                    } else {
                        // Unclosed environment name
                        processedLine += `<span class="environment-name error-highlight" title="Unclosed environment name">${envName}</span>`;
                    }
                    
                    if (contextStack.length > 0) contextStack.pop();
                }
                
            } else {
                // Handle regular text with context awareness
                const currentContext = contextStack.length > 0 ? contextStack[contextStack.length - 1] : 'text';
                
                if (currentContext === 'math') {
                    // Apply special highlighting for math operators
                    if (/[+\-*=<>^_]/.test(line[i])) {
                        processedLine += `<span class="math-operator">${line[i]}</span>`;
                    } else {
                        processedLine += line[i];
                    }
                } else {
                    processedLine += line[i];
                }
                i++;
            }
        }
        
        processedLine += '</div>';
        html += processedLine;
    });
    
    timings.tokenization = performance.now() - tokenizationTime;
    const renderTime = performance.now();
    
    preview.innerHTML = html;
    
    timings.rendering = performance.now() - renderTime;
    const totalTime = performance.now() - startTime;
    
    // Display performance metrics
    const performanceDiv = document.createElement('div');
    performanceDiv.className = 'performance-metrics';
    performanceDiv.innerHTML = `
        <h3>Performance Metrics</h3>
        <table>
            <tr><td>Error Checking:</td><td>${timings.errorChecking.toFixed(2)} ms</td></tr>
            <tr><td>AST Building:</td><td>${timings.astBuilding.toFixed(2)} ms</td></tr>
            <tr><td>Tokenization:</td><td>${timings.tokenization.toFixed(2)} ms</td></tr>
            <tr><td>Rendering:</td><td>${timings.rendering.toFixed(2)} ms</td></tr>
            <tr><td>Total Time:</td><td>${totalTime.toFixed(2)} ms</td></tr>
        </table>
        
        <h3>Document Statistics</h3>
        <table>
            <tr><td>Total Lines:</td><td>${stats.totalLines}</td></tr>
            <tr><td>Commands:</td><td>${stats.totalCommands}</td></tr>
            <tr><td>Math Expressions:</td><td>${stats.totalMathExpressions}</td></tr>
            <tr><td>Environments:</td><td>${stats.totalEnvironments}</td></tr>
            <tr><td>Comments:</td><td>${stats.totalComments}</td></tr>
            <tr><td>Max Nesting Depth:</td><td>${stats.maxNestedDepth}</td></tr>
        </table>
    `;
    
    preview.appendChild(performanceDiv);
}

// LaTeX examples dictionary
const latexExamples = {
    'text-bold': '\\textbf{This is bold text}',
    'text-italic': '\\textit{This is italic text}',
    'text-underline': '\\underline{This is underlined text}',
    'text-smallcaps': '\\textsc{This is small caps text}',
    'text-color': '\\textcolor{red}{This is colored text}',
    
    'math-inline': 'Here is inline math: $x^2 + y^2 = z^2$',
    'math-equation': '\\begin{equation}\n    \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n\\end{equation}',
    'math-fraction': '$\\frac{x+1}{y-1}$',
    'math-sum': '$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$',
    'math-matrix': '\\begin{matrix}\n    a & b \\\\\n    c & d\n\\end{matrix}',
    
    'struct-section': '\\section{Introduction}\nThis is a section.',
    'struct-subsection': '\\subsection{Background}\nThis is a subsection.',
    'struct-itemize': '\\begin{itemize}\n    \\item First item\n    \\item Second item\n    \\item Third item\n\\end{itemize}',
    'struct-enumerate': '\\begin{enumerate}\n    \\item First item\n    \\item Second item\n    \\item Third item\n\\end{enumerate}',
    
    'table-simple': '\\begin{tabular}{|c|c|c|}\n    \\hline\n    A & B & C \\\\\n    \\hline\n    1 & 2 & 3 \\\\\n    \\hline\n\\end{tabular}',
    'table-complex': '\\begin{table}[h]\n    \\caption{Sample Table}\n    \\begin{tabular}{|c|c|}\n        \\hline\n        Header 1 & Header 2 \\\\\n        \\hline\n        Data 1 & Data 2 \\\\\n        \\hline\n    \\end{tabular}\n\\end{table}',
    'figure-basic': '\\begin{figure}[h]\n    \\includegraphics[width=0.8\\textwidth]{example-image}\n    \\caption{Example Figure}\n    \\label{fig:example}\n\\end{figure}',
    
    'env-theorem': '\\begin{theorem}\n    For all right triangles, $a^2 + b^2 = c^2$\n\\end{theorem}',
    'env-proof': '\\begin{proof}\n    This is a proof.\n\\end{proof}',
    'env-quote': '\\begin{quote}\n    This is a quoted text block.\n\\end{quote}',
    'env-verbatim': '\\begin{verbatim}\n    This text will be displayed exactly as typed,\n    including spaces and line breaks.\n\\end{verbatim}',
    
    'ref-label': '\\label{sec:intro} ... See Section~\\ref{sec:intro}',
    'ref-cite': 'As shown in \\cite{author2023}',
    'ref-footnote': 'This statement\\footnote{This is a footnote.} has a footnote.',
    'ref-bibliography': '\\bibliography{references}\n\\bibliographystyle{plain}',

    // Advanced Mathematics
    'math-align': '\\begin{align}\n    y &= mx + b \\\\\n    &= 2x + 1\n\\end{align}',
    'math-cases': '\\begin{cases}\n    x^2 & \\text{if } x > 0 \\\\\n    0 & \\text{if } x = 0 \\\\\n    -x^2 & \\text{if } x < 0\n\\end{cases}',
    'math-limit': '\\lim_{x \\to \\infty} \\frac{1}{x} = 0',
    'math-integral': '\\int_{0}^{1} x^2 dx, \\oint_{C} F \\cdot dr, \\iint_{D} f(x,y) \\,dx\\,dy',
    'math-symbols': '\\alpha + \\beta = \\gamma, \\sum_{i=1}^{n}, \\prod_{j=1}^{m}',

    // Custom Environments
    'env-definition': '\\newenvironment{note}{\n    \\begin{quotation}\n    \\textbf{Note:}\n}{\n    \\end{quotation}\n}',
    'env-theorem-custom': '\\newtheorem{mytheorem}{Custom Theorem}[section]',
    'env-box': '\\newsavebox{\\mybox}\n\\sbox{\\mybox}{This text is saved in a box}',
    'env-command': '\\newcommand{\\mycommand}[2]{\\textbf{#1}: \\textit{#2}}',

    // Page Layout
    'layout-margins': '\\setlength{\\textwidth}{6.5in}\n\\setlength{\\textheight}{9in}\n\\setlength{\\topmargin}{-0.5in}',
    'layout-header': '\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n\\lhead{Left Header}\n\\rhead{Right Header}',
    'layout-columns': '\\begin{multicols}{2}\n    First column content\n    \\columnbreak\n    Second column content\n\\end{multicols}',
    'layout-spacing': '\\vspace{1cm} % Vertical space\n\\hspace{1em} % Horizontal space',

    // Graphics and Colors
    'graphics-tikz': '\\begin{tikzpicture}\n    \\draw (0,0) -- (1,1) -- (2,0) -- cycle;\n    \\fill[red] (1,1) circle (2pt);\n\\end{tikzpicture}',
    'graphics-plot': '\\begin{tikzpicture}\n    \\begin{axis}\n        \\addplot[domain=-2:2] {x^2};\n    \\end{axis}\n\\end{tikzpicture}',
    'graphics-colorbox': '\\colorbox{yellow}{Highlighted text}\n\\fcolorbox{red}{white}{Framed colored box}',
    'graphics-gradient': '\\begin{tikzpicture}\n    \\shade[left color=blue,right color=red] (0,0) rectangle (2,1);\n\\end{tikzpicture}',

    // Code Listings
    'code-basic': '\\begin{lstlisting}[language=Python]\ndef hello():\n    print("Hello, World!")\n\\end{lstlisting}',
    'code-inline': 'Use \\lstinline|print("Hello")| in your code',
    'code-style': '\\lstset{\n    language=C++,\n    basicstyle=\\ttfamily,\n    keywordstyle=\\color{blue}\\bfseries\n}',
    'code-import': '\\lstinputlisting[language=Java]{source_code.java}',

    // Bibliography and Citations
    'bib-natbib': '\\usepackage{natbib}\n\\citep{reference} % (Author, Year)\n\\citet{reference} % Author (Year)',
    'bib-biblatex': '\\usepackage[style=apa]{biblatex}\n\\addbibresource{references.bib}',
    'bib-style': '\\bibliographystyle{plain}\n\\bibliography{references}',
    'bib-custom': '@article{key,\n    author = {Author Name},\n    title = {Title},\n    journal = {Journal},\n    year = {2023}\n}',

    // Presentations (Beamer)
    'beamer-frame': '\\begin{frame}{Slide Title}\n    \\begin{itemize}\n        \\item Point 1\n        \\item Point 2\n    \\end{itemize}\n\\end{frame}',
    'beamer-overlay': '\\begin{frame}{Overlays}\n    \\onslide<1->{First}\n    \\onslide<2->{Second}\n    \\onslide<3->{Third}\n\\end{frame}',
    'beamer-theme': '\\usetheme{Madrid}\n\\usecolortheme{beaver}\n\\setbeamertemplate{navigation symbols}{}',
    'beamer-blocks': '\\begin{frame}{Blocks}\n    \\begin{block}{Block Title}\n        Block content\n    \\end{block}\n\\end{frame}',

    // Advanced Tables
    'table-multirow': '\\begin{tabular}{|c|c|}\n    \\hline\n    \\multirow{2}{*}{Combined} & A \\\\\n    & B \\\\\n    \\hline\n\\end{tabular}',
    'table-longtable': '\\begin{longtable}{|l|l|}\n    \\caption{Long Table} \\\\\n    \\hline\n    Header 1 & Header 2 \\\\\n    \\hline\\endhead\n    Data & More Data \\\\\n    \\hline\n\\end{longtable}',
    'table-colors': '\\begin{tabular}{|c|c|}\n    \\hline\n    \\rowcolor{gray!20} Header 1 & Header 2 \\\\\n    \\hline\n    \\cellcolor{blue!20}Cell 1 & Cell 2 \\\\\n    \\hline\n\\end{tabular}',
    'table-custom': '\\begin{tabular}{|>{\\bfseries}c|>{\\itshape}c|}\n    \\hline\n    Bold & Italic \\\\\n    \\hline\n\\end{tabular}',

    // Common Errors and Fixes
    'error-math': `% ERROR: Missing $ for math mode
x^2 + y^2 = z^2  % This will cause an error

% CORRECT:
$x^2 + y^2 = z^2$

% ERROR: Mismatched math delimiters
$x^2 + y^2 = z^2\\]  % Mixed $ and \\]

% CORRECT:
\\[x^2 + y^2 = z^2\\]

% ERROR: Double dollar confusion
$$x^2$$  % Deprecated

% CORRECT:
\\[x^2\\]  % Preferred for displayed math`,

    'error-brace': `% ERROR: Missing closing brace
\\textbf{Bold text  % Missing }

% CORRECT:
\\textbf{Bold text}

% ERROR: Extra brace
\\textit{Italic text}}  % Extra }

% CORRECT:
\\textit{Italic text}

% ERROR: Nested brace error
\\textbf{\\textit{italic} bold}  % Incorrect nesting

% CORRECT:
\\textbf{\\textit{italic}} \\textbf{bold}`,

    'error-environment': `% ERROR: Mismatched environment names
\\begin{itemize}
    \\item First
\\end{enumerate}  % Wrong environment name

% CORRECT:
\\begin{itemize}
    \\item First
\\end{itemize}

% ERROR: Missing \\begin or \\end
\\begin{equation}
    E = mc^2
% Missing \\end{equation}

% CORRECT:
\\begin{equation}
    E = mc^2
\\end{equation}`,

    'error-special': `% ERROR: Unescaped special characters
% This is a % comment  % Second % causes error
100% complete  % Causes error

% CORRECT:
% This is a comment
100\\% complete

% ERROR: Unescaped underscore outside math
text_with_underscores  % Causes error

% CORRECT:
text\\_with\\_underscores
$text_with_underscores$  % OK in math mode`,

    'error-spacing': `% ERROR: Missing space after command
\\textbf{Bold}text  % No space between command and text

% CORRECT:
\\textbf{Bold} text

% ERROR: Wrong spacing in math
$x+y=z$  % No spacing

% CORRECT:
$x + y = z$  % Better readability

% ERROR: Multiple spaces
This   has   many   spaces  % Will collapse to single spaces

% CORRECT:
This\\quad has\\quad many\\quad spaces`,

    'error-package': `% ERROR: Using command without package
\\includegraphics{image.png}  % Missing \\usepackage{graphicx}

% CORRECT:
\\usepackage{graphicx}
\\includegraphics{image.png}

% ERROR: Wrong package name
\\usepackage{graphics}  % Old package name

% CORRECT:
\\usepackage{graphicx}  % Modern package name`,

    'error-table': `% ERROR: Missing & or \\\\
\\begin{tabular}{|c|c|}
\\hline
A B \\\\  % Missing &
\\hline
\\end{tabular}

% CORRECT:
\\begin{tabular}{|c|c|}
\\hline
A & B \\\\
\\hline
\\end{tabular}

% ERROR: Wrong number of columns
\\begin{tabular}{|c|c|}  % Two columns specified
A & B & C \\\\  % Three columns used
\\end{tabular}

% CORRECT:
\\begin{tabular}{|c|c|c|}  % Three columns specified
A & B & C \\\\
\\end{tabular}`,

    'error-figure': `% ERROR: Missing placement specifier
\\begin{figure}
\\includegraphics{image.png}
\\end{figure}

% CORRECT:
\\begin{figure}[htbp]
\\includegraphics{image.png}
\\end{figure}

% ERROR: Wrong order of float commands
\\begin{figure}[h]
\\caption{Figure}
\\label{fig:1}
\\includegraphics{image.png}  % Label should come after caption

% CORRECT:
\\begin{figure}[h]
\\includegraphics{image.png}
\\caption{Figure}
\\label{fig:1}
\\end{figure}`,

    'error-reference': `% ERROR: Reference before label
See Figure \\ref{fig:example}  % Reference used before label defined

% CORRECT:
\\begin{figure}
    \\includegraphics{image.png}
    \\caption{Example}
    \\label{fig:example}
\\end{figure}
See Figure \\ref{fig:example}

% ERROR: Wrong citation format
\\cite[Smith 2023]  % Wrong syntax

% CORRECT:
\\cite{Smith2023}`,

    'error-unicode': `% ERROR: Direct unicode characters
"Smart quotes" and em—dash  % Will cause errors

% CORRECT:
\\textquote{Correct quotes} and em\\textemdash{}

% ERROR: Accented characters
résumé  % Direct unicode

% CORRECT:
r\\'{e}sum\\'{e}  % Using LaTeX accents
% Or use \\usepackage[utf8]{inputenc}`,

    // Error Messages and Solutions
    'error-msg-undefined': `% Error: Undefined control sequence
\\undefinedcommand  % LaTeX doesn't know this command

% Solution 1: Check spelling
\\textbf  % Correct command

% Solution 2: Load required package
\\usepackage{required-package}
\\commandname`,

    'error-msg-missing': `% Error: Missing $ inserted
x^2 + y^2 = z^2  % Math without $

% Solution: Add math delimiters
$x^2 + y^2 = z^2$  % Inline math
\\[x^2 + y^2 = z^2\\]  % Display math`,

    'error-msg-runaway': `% Error: Runaway argument
\\textbf{Text
continues on next line}  % Bad practice

% Solution: Keep command argument on one line
\\textbf{Text continues on next line}`,

    'error-msg-mismatch': `% Error: Extra } or missing {
\\textbf{text}}  % Extra }
\\textbf{text  % Missing }

% Solution: Match braces carefully
\\textbf{text}  % Correct`,

    'error-msg-file': `% Error: File not found
\\includegraphics{nonexistent.png}

% Solution 1: Check file path
\\graphicspath{{./images/}}
\\includegraphics{existing.png}

% Solution 2: Check file extension
\\includegraphics[scale=0.5]{image.png}`
};

// Create editor
const editor = new EditorView({
    state: EditorState.create({
        doc: '% Start typing LaTeX commands here or select examples below\n',
        extensions: [
            ...basicSetup,
            latexLanguage,
            syntaxHighlighting(defaultlatexHighlightStyle),
            EditorView.theme({
                "&": {
                    height: "100%",
                    maxHeight: "100%"
                },
                ".cm-content": {
                    fontFamily: "monospace",
                    fontSize: "14px",
                    padding: "10px"
                },
                ".cm-line": {
                    padding: "0 8px"
                },
                "&.cm-focused": {
                    outline: "1px solid #ccc"
                }
            })
        ]
    }),
    parent: document.getElementById("editor")
});

// Function to insert selected examples
function insertSelectedExamples() {
    const checkboxes = document.querySelectorAll('.example-checkbox:checked');
    let insertText = '';
    
    checkboxes.forEach((checkbox, index) => {
        const exampleKey = checkbox.getAttribute('data-example');
        const example = latexExamples[exampleKey];
        if (example) {
            insertText += example + '\n\n';
        }
        checkbox.checked = false;
    });
    
    if (insertText) {
        const doc = editor.state.doc;
        const transaction = editor.state.update({
            changes: {
                from: doc.length,
                insert: insertText
            }
        });
        editor.dispatch(transaction);
    }
}

// Add event listeners
document.getElementById('insertSelected').addEventListener('click', insertSelectedExamples);

document.getElementById('processButton').addEventListener('click', () => {
    processLatex(editor.state.doc.toString());
});

document.getElementById('clearButton').addEventListener('click', () => {
    editor.dispatch({
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: ''
        }
    });
    document.getElementById('preview').innerHTML = '';
});

// Make example items clickable
document.querySelectorAll('.command-group li').forEach(item => {
    item.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
            const checkbox = item.querySelector('.example-checkbox');
            checkbox.checked = !checkbox.checked;
        }
    });
});

// Add styles for the preview
const style = document.createElement('style');
style.textContent = `
    .processed-line {
        margin: 4px 0;
        font-family: monospace;
        line-height: 1.5;
    }
    
    /* Command highlighting by category */
    .command {
        color: #0000ff;
        font-weight: bold;
    }
    .structure-command {
        color: #8a2be2; /* BlueViolet */
        font-weight: bold;
    }
    .environment-command {
        color: #4b0082; /* Indigo */
        font-weight: bold;
    }
    .formatting-command {
        color: #0070c0; /* Bright Blue */
        font-weight: bold;
    }
    .math-command {
        color: #c71585; /* MediumVioletRed */
        font-weight: bold;
    }
    .figure-command {
        color: #008080; /* Teal */
        font-weight: bold;
    }
    .reference-command {
        color: #4682b4; /* SteelBlue */
        font-weight: bold;
    }
    .list-command {
        color: #006400; /* DarkGreen */
        font-weight: bold;
    }
    .document-command {
        color: #8b0000; /* DarkRed */
        font-weight: bold;
    }
    .general-command {
        color: #0000cd; /* MediumBlue */
        font-weight: bold;
    }
    
    /* Other LaTeX elements */
    .argument {
        color: #008800;
    }
    .environment-name {
        color: #9400d3; /* DarkViolet */
        font-weight: bold;
    }
    .math {
        color: #ff0000;
        font-style: italic;
    }
    .math-operator {
        color: #ff00ff; /* Magenta */
        font-weight: bold;
    }
    .comment {
        color: #888888;
        font-style: italic;
    }
    .brace {
        color: #000000;
        font-weight: normal;
    }
    
    /* Error highlighting */
    .error-line {
        background-color: #fff3f3;
        border-left: 3px solid #ff0000;
        padding: 5px;
        margin: 5px 0;
        border-radius: 3px;
    }
    .error-message {
        color: #ff0000;
        font-weight: bold;
        margin-bottom: 5px;
    }
    .error-explanation {
        color: #666666;
        margin: 5px 0;
        font-style: italic;
    }
    .error-suggestion {
        color: #008000;
        font-family: monospace;
        background-color: #f0f0f0;
        padding: 5px;
        border-radius: 3px;
        white-space: pre-wrap;
    }
    .error-highlight {
        background-color: #ffdddd;
        border-bottom: 1px dashed #ff0000;
    }
    
    /* Performance metrics and statistics */
    .performance-metrics {
        margin-top: 20px;
        padding: 10px;
        background-color: #f8f8f8;
        border: 1px solid #ccc;
        border-radius: 5px;
        font-family: Arial, sans-serif;
    }
    .performance-metrics h3 {
        margin-top: 10px;
        margin-bottom: 5px;
        color: #333;
        font-size: 16px;
    }
    .performance-metrics table {
        width: 100%;
        border-collapse: collapse;
    }
    .performance-metrics td {
        padding: 3px 8px;
        border-bottom: 1px solid #eee;
    }
    .performance-metrics tr:nth-child(even) {
        background-color: #f0f0f0;
    }
    .performance-metrics tr:last-child {
        font-weight: bold;
    }
`;
document.head.appendChild(style);

// Add button for performance testing
const testButton = document.createElement('button');
testButton.id = 'testButton';
testButton.className = 'action-button';
testButton.textContent = 'Run Performance Test';
testButton.style.marginLeft = '10px';
testButton.addEventListener('click', () => {
    const text = editor.state.doc.toString();
    const results = performanceTest(text, 5);
    
    // Display results in a popup
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'performance-results-popup';
    resultsDiv.innerHTML = `
        <h3>Performance Test Results (5 iterations)</h3>
        <table>
            <tr><td>Error Checking:</td><td>${results.errorChecking.toFixed(2)} ms</td></tr>
            <tr><td>AST Building:</td><td>${results.astBuilding.toFixed(2)} ms</td></tr>
            <tr><td>Tokenization:</td><td>${results.tokenization.toFixed(2)} ms</td></tr>
            <tr><td>Rendering:</td><td>${results.rendering.toFixed(2)} ms</td></tr>
            <tr><td>Total Time:</td><td>${results.totalTime.toFixed(2)} ms</td></tr>
        </table>
        <button id="closeResults">Close</button>
    `;
    
    document.body.appendChild(resultsDiv);
    document.getElementById('closeResults').addEventListener('click', () => {
        document.body.removeChild(resultsDiv);
    });
});

// Insert the test button after the process button
document.getElementById('processButton').parentNode.insertBefore(
    testButton, 
    document.getElementById('processButton').nextSibling
);

// Add performance test results popup style
const popupStyle = document.createElement('style');
popupStyle.textContent = `
    .performance-results-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 20px;
        border-radius: 5px;
        box-shadow: 0 0 20px rgba(0,0,0,0.3);
        z-index: 1000;
        font-family: Arial, sans-serif;
    }
    .performance-results-popup h3 {
        margin-top: 0;
        color: #333;
    }
    .performance-results-popup table {
        margin: 15px 0;
        width: 100%;
        border-collapse: collapse;
    }
    .performance-results-popup td {
        padding: 5px 10px;
        border-bottom: 1px solid #eee;
    }
    .performance-results-popup tr:last-child {
        font-weight: bold;
    }
    .performance-results-popup button {
        padding: 5px 15px;
        background-color: #0066cc;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        float: right;
    }
    .performance-results-popup button:hover {
        background-color: #0055aa;
    }
`;
document.head.appendChild(popupStyle);