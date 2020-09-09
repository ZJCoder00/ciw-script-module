const Parser = {
    // 正则匹配规则
    syntax: {
        Comment: /\/\/[^\n]*/,
        String: /("[^\n"]*"?)|('[^\n']*'?)/,
        Number: /\b\d+(\.\d+)?\b/,
        Keyword: /\b(num|str|if|else|for|break)\b/,
        Identifier: /\b[a-zA-Z_]\w*\b/,
        Paren: /[\(\)]/,
        Bracket: /[\[\]]/,
        Brace: /[\{\}]/,
        Operator: /(>=|<=|==|!=|\+=|\-=|\+\+|\-\-|&&|\|\|)|[><\+\-\*\/%=!~\.]/,
        Separator: /[,;]/,
        Space: /\s/
    },
    // 错误处理
    error: (line, position, message, abort = true) => {
        console.log(`行${line} 位置${position}: ${message}`)
        if (abort) throw [line, position, message]
    },
    // 内置
    buildin: {
        Object: { },
        Property: { },
        Function: { }
    },
    // 词法分析
    token: function (code, edit) {
        // 正则拆分代码
        let regExp = ''
        for (let type in this.syntax) {
            regExp += `(${this.syntax[type].source})|`
        }
        regExp += '(\\w+)|(.)'
        let split = code.match(new RegExp(regExp, 'g'))
        if (!split) return;
        // 构建token
        let token = [], line = 1, position = 0
        for (let i = 0; i < split.length; i++ ){
            let element, value = split[i]
            // 记录行数和位置
            if (value === '\n') {
                line++
                position = 0
            } else {
                position += value.length
            }
            // 匹配类型
            for (let type in this.syntax) {
                if (this.syntax[type].test(value)) {
                    // 创建词法元素
                    element = { value, type, line, position, i: token.length }
                    // 检测内置标识符
                    if (type === "Identifier") {
                        for (let k in this.buildin) {
                            if (Object.keys(this.buildin[k]).includes(value)) {
                                element.buildin = k
                                break
                            }
                        }
                    }
                    // 加入到token中
                    if (edit) {
                        token.push(element)
                    } else {
                        // 非编辑模式下过滤注释和空白
                        if (type !== "Comment" && type !== "Space") token.push(element)
                    }
                    break
                }
            }
            // 未匹配到类型抛出错误
            if (!element) {
                this.error(line, position, '字符错误', !edit)
                if (edit) token.push({ value, type: 'Error', line, position })
            }
        }
        token.line = line
        return token
    },
    // 运算符优先级
    precedence: operator => {
        let r = [
            ['.'],
            ['/','*','%'],
            ['+', '-'],
            ['>', '>=', '<', '<='],
            ['==', '!='],
            ['&&'],
            ['||'],
            ['=','+=','-=']
        ].findIndex(o => o.includes(operator))
        return r === -1 ? 10 : r
    },
    // 语法分析
    parse: function (token) {
        if (!token) return;
        let index = 0,// 当前索引
            nowPrecedence = 10,// 当前优先级
            brace = [],// 大括号匹配堆栈
            ifelse = [],// if else匹配堆栈
            vars = [],// 变量记录
            funcs = this.buildin.Function,
            arrays = {}
        // 内置标识符加入到变量记录
        for (let k in this.buildin.Object) {
            vars.push(k)
            vars[k] = "Object"
        }
        for (let k in this.buildin.Property) {
            vars.push(k)
            vars[k] = this.buildin.Property[k]
        }
        for (let k in this.buildin.Function) {
            vars.push(k)
            vars[k] = "Function"
        }
        // 处理表达式
        const expression = node => {
            checkTypes(1, valueTypes, node, index - 1)
            if (token[index] && token[index].type === "Operator") {
                check(index, '.')
                let now = this.precedence(token[index].value)
                if (now === 7) this.error(token[index].line, token[index].position, "语法错误")
                if (now < nowPrecedence) {
                    let pre = nowPrecedence
                    nowPrecedence = now
                    let exp = {
                        type: "Expression",
                        left: node,
                        position: index,
                        operator: token[index++].value,
                        right: generate()
                    }
                    checkTypes(1, valueTypes, exp.right, index - 1)
                    checkValueType(exp)
                    while (token[index] && token[index].type === "Operator") {
                        check(index, '.')
                        let now = this.precedence(token[index].value)
                        if (now === 7) this.error(token[index].line, token[index].position, "语法错误")
                        if (now >= nowPrecedence && now < pre) {
                            let pre = nowPrecedence
                            nowPrecedence = now
                            let parent = {
                                type: "Expression",
                                left: exp,
                                position: index,
                                operator: token[index++].value,
                                right: generate()
                            }
                            nowPrecedence = pre
                            exp = parent
                            checkTypes(1, valueTypes, exp.right, index - 1)
                            checkValueType(exp)
                        } else {
                            break
                        }
                    }
                    nowPrecedence = pre
                    return exp
                } else {
                    return node
                }
            } else {
                return node
            }
        },
        // 处理列表
        list = (array, end, type) => {
            let pre = index++
            nowPrecedence = 10
            while (token[index] && token[index].value !== end) {
                if (token[index].value === ',') index++
                let p = generate(0)
                checkTypes(1, valueTypes, p, index - 1)
                if (Array.isArray(type)) {
                    if (p.valueType !== type[array.length]) this.error(token[index - 1].line, token[index - 1].position, "参数类型错误")
                } else {
                    if (p.valueType !== type) this.error(token[index - 1].line, token[index - 1].position, "类型错误")
                }
                array.push(p)
            }
            array.type = type
            check(index, end, 1, index - pre)
            index++
        },
        // 检查字符
        check = (index, value, mode = 0, offset = 0) => {
            if (mode ? (!token[index] || token[index].value !== value) : (token[index] && token[index].value === value)) {
                let t = token[index - offset]
                this.error(t.line, t.position, "语法错误")
            }
        },
        // 检查表达式类型
        checkTypes = (has, types, node, index) => {
            if (!node || types.includes(node.type) === !has) {
                if (node && node.position) index = node.position
                this.error(token[index].line, token[index].position, "语法错误")
            }
        },
        // 检查值类型
        checkValueType = expression => {
            let operator = expression.operator,
                left = expression.left.valueType,
                right = expression.right.valueType,
                { line, position } = token[expression.position],
                invalid = ["Object", "Array", "Function"]
            try {
                switch (operator) {
                    case '+':
                        if (invalid.includes(left) || invalid.includes(right)) throw 0
                        if (left === right) {
                            expression.valueType = left
                        } else if (left === "String" && right === "Number") {
                            expression.valueType = "String"
                        } else if (left === "Number" && right === "String") {
                            expression.valueType = "String"
                        } else {
                            throw 0
                        }
                        break
                    case '-': case '*': case '/': case '%':
                        if (invalid.includes(left) || invalid.includes(right)) throw 0
                        if (left === right) {
                            expression.valueType = left
                        } else {
                            throw 0
                        }
                        break
                    case '>': case '>=': case '<': case '<=':
                        if (left === "Number" && right === "Number") {
                            expression.valueType = "Number"
                        } else {
                            throw 0
                        }
                        break
                    case '==': case '!=': case '&&': case '||':
                        expression.valueType = "Number"
                        break
                    default: this.error(line, position, "运算符错误")
                }
            } catch {
                this.error(line, position, `运算符错误: ${left}和${right}类型不能使用'${operator}'`)
            }
        },
        // 仅等号右边的类型
        rightTypes = ["UnaryExpression", "Expression", "Member", "Array", "Number", "String", "Identifier"],
        // 作为值的类型
        valueTypes = [...rightTypes, "Call"]
        // 生成语法树
        generate = (step = 1, type) => {
            let now = token[index]
            // 代码结束检测
            if (!now) {
                if (token[index - 1].value === ';') {
                    return;
                } else {
                    this.error(token[index - 1].line, token[index - 1].position, "语法错误")
                }
            }
            // 分类处理
            switch (now.type) {
                case "String": {
                    index++
                    return expression({ type: "String", value: now.value, valueType: "String" })
                }
                case "Number": {
                    index++
                    return expression({ type: "Number", value: Number(now.value), valueType: "Number" })
                }
                case "Paren":
                    if (now.value === "(") {
                        index++
                        let p = nowPrecedence
                        nowPrecedence = 10
                        let node = generate()
                        nowPrecedence = p
                        check(index, ')', 1, index - now.i)
                        index++
                        return expression(node)
                    } else {
                        this.error(now.line, now.position, "语法错误")
                    }
                    break
                case "Bracket":
                    if (now.value === "[") {
                        let node = {
                            type: "Array",
                            elements: [],
                            valueType: "Array"
                        }
                        list(node.elements, ']', type)
                        return node
                    } else {
                        this.error(now.line, now.position, "语法错误")
                    }
                    break
                case "Brace":
                    if (now.value === "{") {
                        let node = []
                        index++
                        nowPrecedence = 10
                        brace.push(now)
                        while (token[index] && token[index].value !== "}") {
                            let s = generate()
                            if (s) {
                                checkTypes(0, rightTypes, s, index - 1)
                                node.push(s)
                            }
                        }
                        check(index, '}', 1, index - now.i)
                        index++
                        brace.pop()
                        return node
                    } else {
                        if (brace.length) {
                            brace.pop()
                        } else {
                            this.error(now.line, now.position, "语法错误")
                        }
                    }
                    break
                case "Keyword": {
                    index++
                    let node = {}
                    switch (now.value) {
                        case "num": case "str":
                            node.type = "Declare"
                            node.varibles = []
                            if (!token[index]) this.error(now.line, now.position, "语法错误")
                            while (token[index].value !== ';') {
                                let name = token[index]
                                if (name.type !== "Identifier") this.error(name.line, name.position, "语法错误")
                                if (vars.includes(name.value)) this.error(name.line, name.position, "变量名冲突")
                                let v = { name: name.value }
                                node.varibles.push(v)
                                vars.push(name.value)
                                vars[name.value] = now.value === "num" ? "Number": "String"
                                let operator = token[++index]
                                if (!operator || operator.value === ';') break
                                if (operator.value === ',') {
                                    index++
                                } else if (operator.value === '=') {
                                    index++
                                    v.value = generate(0, vars[name.value])
                                    checkTypes(1, valueTypes, v.value, index - 1)
                                    if (v.value.valueType === "Array") {
                                        vars[name.value] = "Array"
                                        arrays[name.value] = v.value.elements.type
                                    } else if (v.value.valueType !== vars[name.value]) {
                                        this.error(operator.line, operator.position, "赋值类型错误")
                                    }
                                    if (!token[index]) break
                                    if (token[index].value === ',') {
                                        if (!token[++index]) this.error(token[index - 1].line, token[index - 1].position, "语法错误")
                                    }
                                } else {
                                    this.error(operator.line, operator.position, "语法错误")
                                }
                            }
                            break
                        case "if":
                            node.type = "If"
                            node.condition = generate()
                            checkTypes(1, valueTypes, node.condition, index - 1)
                            node.body = generate()
                            checkTypes(0, rightTypes, node.body, index - 1)
                            ifelse.push(node)
                            break
                        case "else":
                            let ifnode = ifelse.pop()
                            if (ifnode) {
                                ifnode.else = generate()
                                checkTypes(0, rightTypes, ifnode.else, index - 1)
                                return;
                            } else {
                                this.error(now.line, now.position, "语法错误")
                            }
                            break
                        case "for":
                            node.type = "For"
                            check(index, '(', 1, index - 1)
                            index++
                            node.init = generate()
                            checkTypes(0, rightTypes, node.init, index - 1)
                            check(index, ';', 1, index - now.i)
                            index++
                            node.test = generate()
                            checkTypes(1, valueTypes, node.test, index - 1)
                            check(index, ';', 1, index - now.i)
                            index++
                            node.update = generate()
                            checkTypes(0, rightTypes, node.update, index - 1)
                            check(index, ')', 1, index - now.i)
                            index++
                            node.body = generate()
                            break
                        case "break":
                            node.type = "Break"
                            break
                    }
                    return node
                }
                case "Identifier": {
                    if (!vars.includes(now.value)) this.error(now.line, now.position, "未知变量")
                    index++
                    let node, id = {
                        type: "Identifier",
                        value: now.value
                    }, operator = token[index]
                    if (vars[now.value]) {
                        id.valueType = vars[now.value]
                        if (funcs[now.value]) {
                            id.returnType = funcs[now.value].output
                            id.inputType = funcs[now.value].input
                        }
                    }
                    while (operator && (operator.value === '.' || operator.value === '[')) {
                        if (id.valueType !== "Object" && id.valueType !== "Array") this.error(operator.line, operator.position, "语法错误")
                        let m = {
                            type: "Member",
                            object: id,
                            position: index++
                        }
                        if (!token[index]) this.error(token[index - 1].line, token[index - 1].position, "语法错误")
                        if (operator.value === '.') {
                            if (token[index].type !== 'Identifier') this.error(token[index].line, token[index].position, "语法错误")
                            let v = token[index].value
                            m.property = {
                                type: "Identifier",
                                value: v
                            }
                            if (vars[v]) {
                                m.valueType = vars[v]
                                if (funcs[v]) {
                                    m.returnType = funcs[v].output
                                    m.inputType = funcs[v].input
                                }
                            }
                        } else {
                            let t = arrays[id.value||id.property.value]
                            if (!t) this.error(operator.line, operator.position, "语法错误")
                            m.property = generate()
                            m.valueType = t
                            check(index, ']', 1, index - m.position)
                            checkTypes(1, valueTypes, m.property, index - 1)
                        }
                        id = m
                        operator = token[++index]
                    }
                    if (token[index]) {
                        switch (token[index].value) {
                            case "(":
                                if (id.valueType !== "Function") this.error(token[index].line, token[index].position, "语法错误")
                                node = {
                                    type: "Call",
                                    caller: id,
                                    params: [],
                                    valueType: id.returnType
                                }
                                list(node.params, ')', id.inputType)
                                if (node.params.length !== id.inputType.length) this.error(token[index - 2].line, token[index - 2].position, `参数数量错误：需要${id.inputType.length}个参数`)
                                return expression(node)
                            case '=':
                            case '+=':
                            case '-=':
                                if (id.valueType === "Object" || id.valueType === "Array" || id.valueType === "Function") this.error(token[index].line, token[index].position, `${id.valueType}类型不可赋值`)
                                node = {
                                    type: "Assignment",
                                    left: id,
                                    position: index,
                                    operator: token[index++].value,
                                    right: generate(),
                                }
                                checkTypes(1, valueTypes, node.right, index - 1)
                                if (id.valueType !== node.right.valueType) this.error(token[node.position].line, token[node.position].position, "赋值类型错误")
                                break
                            case '++':
                            case '--':
                                if (id.valueType !== "Number") this.error(token[index].line, token[index].position, `运算符错误: ${id.valueType}类型不能使用'${token[index].value}'`)
                                node = {
                                    type: "Assignment",
                                    left: id,
                                    position: index,
                                    operator: token[index++].value
                                }
                                break
                        }
                    }
                    return node || expression(id)
                }
                case "Separator":
                    index += step
                    nowPrecedence = 10
                    break
                default:
                    if (now.value === '-' || now.value === '!') {
                        let node = {
                            type: "UnaryExpression",
                            operator: token[index++].value,
                            right: generate()
                        }
                        checkTypes(1, valueTypes, node.right, index - 1)
                        return expression(node)
                    }
                    this.error(now.line, now.position, "语法错误")
            }
        }
        // 语法树根节点
        let AST = {
            type: "Program",
            body: []
        }
        while (index < token.length) {
            try {
                let s = generate()
                if (s) {
                    checkTypes(0, rightTypes, s, index - 1)
                    AST.body.push(s)
                }
            } catch (e) {
                throw e
            }
        }
        return AST
    }
}