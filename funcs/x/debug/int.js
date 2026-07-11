async function p (){
    a = 1 
    b = 1 
    c = a +  b 

    console.log("cccc")
    return c 
}

async  function test() {

    const a =   p() 
    console.log("aaaa")
    a.then()
}

test()